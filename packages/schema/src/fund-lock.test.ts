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

async function build() {
  return chain.buildFundLock(params);
}

describe("buildFundLock", () => {
  it("makes the requester both the debited account and the fee payer, so one signature covers both", async () => {
    const built = await build();
    const decoded = JSON.parse(atob(built.transactionBytes));

    expect(decoded.from).toBe(REQUESTER);
    expect(decoded.feePayer).toBe(REQUESTER);
    expect(decoded.to).toBe(built.escrowAccountId);
    expect(decoded.amountTinybars).toBe(params.amountTinybars);
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
    await rejects(tamper(signFundLock(built.transactionBytes, REQUESTER), { amountTinybars: "1" }), "wrong-amount");
  });

  it("refuses a redirected credit — the caller cannot pay themselves instead of the escrow", async () => {
    const built = await build();
    await rejects(tamper(signFundLock(built.transactionBytes, REQUESTER), { to: "0.0.9999" }), "wrong-escrow-account");
  });

  it("refuses a substituted debited account — the caller cannot spend somebody else's balance", async () => {
    const built = await build();
    await rejects(tamper(signFundLock(built.transactionBytes, REQUESTER), { from: "0.0.9999" }), "wrong-debited-account");
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
    await rejects(
      tamper(signFundLock(built.transactionBytes, REQUESTER), { from: "0.0.9999" }),
      "wrong-debited-account",
    );
    await rejects(signFundLock(built.transactionBytes, "0.0.9999"), "wrong-signer");
  });

  it("refuses a lock whose validity window has passed, rather than submitting a doomed transaction", async () => {
    const built = await build();
    const signed = signFundLock(built.transactionBytes, REQUESTER);
    clock = START + (FUND_LOCK_VALID_SECONDS + 1) * 1000;

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
