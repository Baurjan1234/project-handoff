/**
 * PROPOSAL. Tests for `RequesterFundedEscrow` on the mock.
 *
 * The point of these is not that the mock works. It is that the *exchange* has
 * exactly one accepting path and that every way of tampering with the returned
 * bytes is refused before anything executes — because in the real adapter the
 * bytes have crossed the wire from whoever called the endpoint.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { FundLockError, type LockFundsParams } from "./adapter.js";
import { FUND_LOCK_VALID_SECONDS, MockChainAdapter, signFundLock } from "./mock.js";

const REQUESTER = "0.0.4004";
const START = 1_757_000_000_000;

const params: LockFundsParams = {
  orderId: "order-1",
  amountTinybars: "10000000000",
  requesterAccountId: REQUESTER,
};

let clock: number;
let chain: MockChainAdapter;

beforeEach(() => {
  clock = START;
  chain = new MockChainAdapter({ now: () => clock });
});

/** Re-encodes a built lock with one field changed, the way a hostile caller would. */
function tamper(transactionBytes: string, changes: Record<string, unknown>): string {
  const decoded: unknown = JSON.parse(atob(transactionBytes));
  return btoa(JSON.stringify({ ...(decoded as Record<string, unknown>), ...changes }));
}

interface Leg {
  accountId: string;
  amountTinybars: string;
}

function legsOf(transactionBytes: string): Leg[] {
  return (JSON.parse(atob(transactionBytes)) as { transfers: Leg[] }).transfers;
}

/** The debit is leg 0 and the credit is leg 1, as `buildFundLock` writes them. */
function tamperLeg(transactionBytes: string, index: number, changes: Partial<Leg>): string {
  const transfers = legsOf(transactionBytes);
  transfers[index] = { ...(transfers[index] as Leg), ...changes };
  return tamper(transactionBytes, { transfers });
}

async function build() {
  return chain.buildFundLock(params);
}

describe("buildFundLock", () => {
  it("makes the requester both the debited account and the fee payer, so one signature covers both", async () => {
    const built = await build();
    const decoded = JSON.parse(atob(built.transactionBytes));

    expect(decoded.feePayer).toBe(REQUESTER);
    expect(decoded.transfers).toEqual([
      { accountId: REQUESTER, amountTinybars: `-${params.amountTinybars}` },
      { accountId: built.escrowAccountId, amountTinybars: params.amountTinybars },
    ]);
  });

  it("writes legs that net to zero, the way a transfer has to", async () => {
    const built = await build();
    const total = legsOf(built.transactionBytes).reduce(
      (sum, leg) => sum + BigInt(leg.amountTinybars),
      0n,
    );
    expect(total).toBe(0n);
  });

  it("hands back nothing signed — the server never signs the requester's transfer", async () => {
    const built = await build();
    expect(JSON.parse(atob(built.transactionBytes)).signedBy).toEqual([]);
  });

  it("states when the frozen transfer stops being submittable", async () => {
    const built = await build();
    expect(built.validUntil).toBe("2025-09-04T15:36:20Z");
    expect(Date.parse(built.validUntil) - START).toBe(FUND_LOCK_VALID_SECONDS * 1000);
  });
});

describe("submitFundLock accepts exactly one thing", () => {
  it("submits a lock the requester signed, and threads the transaction id", async () => {
    const built = await build();
    const escrow = await chain.submitFundLock(params, signFundLock(built.transactionBytes, REQUESTER));

    expect(escrow.escrowAccountId).toBe(built.escrowAccountId);
    expect(await chain.getTransaction(escrow.transactionId)).toMatchObject({ status: "SUCCESS" });
  });

  it("is a no-op to sign twice, so a retrying client cannot corrupt its own bytes", async () => {
    const built = await build();
    const once = signFundLock(built.transactionBytes, REQUESTER);
    expect(signFundLock(once, REQUESTER)).toBe(once);
  });
});

describe("submitFundLock refuses everything else", () => {
  const rejects = async (bytes: string, reason: string) => {
    await expect(chain.submitFundLock(params, bytes)).rejects.toMatchObject({
      name: "FundLockError",
      reason,
    });
  };

  it("refuses bytes that do not decode", async () => {
    await rejects("not base64 at all !!", "unparseable");
  });

  it("refuses bytes that decode but are missing fields", async () => {
    await rejects(btoa(JSON.stringify({ kind: "transfer" })), "unparseable");
  });

  it("refuses a transaction that is not a transfer", async () => {
    const built = await build();
    await rejects(tamper(signFundLock(built.transactionBytes, REQUESTER), { kind: "accountDelete" }), "not-a-transfer");
  });

  it("refuses an edited amount — the caller cannot lock less than the order is priced at", async () => {
    const built = await build();
    const signed = signFundLock(built.transactionBytes, REQUESTER);
    await rejects(tamperLeg(signed, 1, { amountTinybars: "1" }), "wrong-amount");
  });

  it("refuses an inflated debit even when the escrow is credited correctly", async () => {
    // Checking the credit alone would let a caller be debited more than the
    // order is priced at, which is their money going somewhere they did not
    // agree to. Both legs are matched.
    const built = await build();
    const signed = signFundLock(built.transactionBytes, REQUESTER);
    await rejects(tamperLeg(signed, 0, { amountTinybars: "-99999999999" }), "wrong-amount");
  });

  it("refuses an amount that is not a figure, as a FundLockError and not a MoneyError", async () => {
    // Each of these is a string, so it satisfies the shape check and reaches
    // the money module. Escaping as a MoneyError would leave a handler with
    // no `reason` to map, for exactly the tamper the whitelist is here for.
    const built = await build();
    const signed = signFundLock(built.transactionBytes, REQUESTER);

    for (const amountTinybars of ["abc", "1e9", "010000000000", "99999999999999999999", ""]) {
      await rejects(tamperLeg(signed, 1, { amountTinybars }), "wrong-amount");
    }
  });

  it("refuses a redirected credit — the caller cannot pay themselves instead of the escrow", async () => {
    const built = await build();
    const signed = signFundLock(built.transactionBytes, REQUESTER);
    await rejects(tamperLeg(signed, 1, { accountId: "0.0.9999" }), "wrong-escrow-account");
  });

  it("refuses a substituted debited account — the caller cannot spend somebody else's balance", async () => {
    const built = await build();
    const signed = signFundLock(built.transactionBytes, REQUESTER);
    await rejects(tamperLeg(signed, 0, { accountId: "0.0.9999" }), "wrong-debited-account");
  });

  it("refuses a third leg — the attack a from/to pair could not even express", async () => {
    // The escrow is credited correctly and the legs still net to zero. The
    // caller has simply added themselves a credit and inflated the debit to
    // pay for it. This is what `extra-transfers` is for, and while the mock
    // modelled one from/to pair nothing could produce that reason at all.
    const built = await build();
    const signed = signFundLock(built.transactionBytes, REQUESTER);
    const [debit, credit] = legsOf(signed) as [Leg, Leg];

    const withRider = tamper(signed, {
      transfers: [
        { accountId: debit.accountId, amountTinybars: `${BigInt(debit.amountTinybars) - 500n}` },
        credit,
        { accountId: "0.0.9999", amountTinybars: "500" },
      ],
    });

    await rejects(withRider, "extra-transfers");
  });

  it("refuses a lock with a leg missing", async () => {
    const built = await build();
    const signed = signFundLock(built.transactionBytes, REQUESTER);
    await rejects(tamper(signed, { transfers: [legsOf(signed)[1]] }), "extra-transfers");
  });

  it("refuses a zero leg, which is neither a debit nor a credit", async () => {
    const built = await build();
    const signed = signFundLock(built.transactionBytes, REQUESTER);
    await rejects(tamperLeg(signed, 0, { amountTinybars: "0" }), "extra-transfers");
  });

  it("refuses a substituted fee payer, which is how the platform would end up paying again", async () => {
    const built = await build();
    await rejects(tamper(signFundLock(built.transactionBytes, REQUESTER), { feePayer: "0.0.9999" }), "wrong-fee-payer");
  });

  it("refuses an unsigned lock", async () => {
    const built = await build();
    await rejects(built.transactionBytes, "unsigned");
  });

  it("refuses a lock somebody other than the requester signed", async () => {
    const built = await build();
    await rejects(signFundLock(built.transactionBytes, "0.0.9999"), "wrong-signer");
  });

  it("tells a wrong-account build apart from a wrong-key signature", async () => {
    // The two used to share one reason, which left a client unable to know
    // whether to rebuild the transfer or re-sign it.
    const built = await build();
    const signed = signFundLock(built.transactionBytes, REQUESTER);
    await rejects(tamperLeg(signed, 0, { accountId: "0.0.9999" }), "wrong-debited-account");
    await rejects(signFundLock(built.transactionBytes, "0.0.9999"), "wrong-signer");
  });

  it("refuses a lock whose validity window has passed, rather than submitting a doomed transaction", async () => {
    const built = await build();
    const signed = signFundLock(built.transactionBytes, REQUESTER);
    clock = START + (FUND_LOCK_VALID_SECONDS + 1) * 1000;

    await rejects(signed, "expired");
  });

  it("refuses a forged window, which is the tamper an expiry-only check waves through", async () => {
    const built = await build();
    const signed = signFundLock(built.transactionBytes, REQUESTER);

    await rejects(tamper(signed, { validUntil: "3000-01-01T00:00:00Z" }), "window-too-long");
  });

  it("refuses a window that is not an instant, rather than reading NaN as in range", async () => {
    // `NaN <= now` and `NaN > upper` are both false, so an unguarded pair of
    // comparisons accepts anything unparseable.
    const built = await build();
    const signed = signFundLock(built.transactionBytes, REQUESTER);

    await rejects(tamper(signed, { validUntil: "whenever" }), "unparseable");
  });

  it("calls an honestly stale build expired, not a forgery", async () => {
    const built = await build();
    const signed = signFundLock(built.transactionBytes, REQUESTER);
    clock = START + (FUND_LOCK_VALID_SECONDS + 20) * 1000;

    await rejects(signed, "expired");
  });

  it("still accepts one second before the window closes", async () => {
    const built = await build();
    const signed = signFundLock(built.transactionBytes, REQUESTER);
    clock = START + (FUND_LOCK_VALID_SECONDS - 1) * 1000;

    await expect(chain.submitFundLock(params, signed)).resolves.toMatchObject({
      escrowAccountId: built.escrowAccountId,
    });
  });

  it("moves no money when it refuses — nothing is recorded for a rejected lock", async () => {
    const built = await build();
    await expect(chain.submitFundLock(params, built.transactionBytes)).rejects.toThrow(FundLockError);

    const escrow = await chain.submitFundLock(params, signFundLock(built.transactionBytes, REQUESTER));
    // The accepted lock is the *first* transaction this adapter ever issued.
    // Asserting only that it succeeded would pass whether or not the refusal
    // burnt an id, which is the thing the title claims to check.
    expect(escrow.transactionId).toBe("MOCK-tx-1");
    expect(await chain.getTransaction(escrow.transactionId)).toMatchObject({ status: "SUCCESS" });
  });
});
