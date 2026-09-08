import { describe, expect, it } from "vitest";
import { preflight, readAccount, type PreflightDeps } from "./preflight.js";

const MIRROR = "https://testnet.mirrornode.hedera.com/api/v1";
const PAYER = "0.0.10376659";

/** A mirror node that answers with one account body. */
function mirror(body: unknown, status = 200): PreflightDeps {
  return {
    mirrorNodeUrl: MIRROR,
    async fetch() {
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    },
  };
}

function account(keyType: string, balanceTinybars: number | string) {
  return { key: { _type: keyType }, balance: { balance: balanceTinybars } };
}

const FEE = "50000000"; // 0.5 HBAR
const ESCROW = "10000000000"; // 100 HBAR

describe("readAccount", () => {
  it("reads the key type and the balance from one call", async () => {
    const facts = await readAccount(PAYER, mirror(account("ECDSA_SECP256K1", 4200000000)));

    expect(facts).toEqual({
      status: "found",
      keyType: "ECDSA_SECP256K1",
      balanceTinybars: "4200000000",
    });
  });

  it("calls the accounts endpoint without dragging transactions along", async () => {
    let seen = "";
    await readAccount(PAYER, {
      mirrorNodeUrl: `${MIRROR}/`,
      async fetch(url) {
        seen = url;
        return new Response(JSON.stringify(account("ECDSA_SECP256K1", 1)), { status: 200 });
      },
    });

    expect(seen).toBe(`${MIRROR}/accounts/0.0.10376659?transactions=false`);
  });

  it("is not-found on a 404", async () => {
    expect(await readAccount(PAYER, mirror({}, 404))).toEqual({ status: "not-found" });
  });

  it("is unreachable, with the reason, when the mirror node throws", async () => {
    const facts = await readAccount(PAYER, {
      mirrorNodeUrl: MIRROR,
      async fetch() {
        throw new Error("connect ECONNREFUSED");
      },
    });

    expect(facts).toEqual({ status: "unreachable", reason: "connect ECONNREFUSED" });
  });

  it("treats an unparseable balance as unreadable, never as zero", async () => {
    // Zero would refuse an order the payer could afford, which is the more
    // expensive way to be wrong.
    const facts = await readAccount(PAYER, mirror({ key: { _type: "ECDSA_SECP256K1" }, balance: {} }));

    expect(facts.status).toBe("unreachable");
  });

  it("names an exotic key as other rather than guessing a curve", async () => {
    const facts = await readAccount(PAYER, mirror(account("ProtobufEncoded", 1)));

    expect(facts).toMatchObject({ status: "found", keyType: "other" });
  });
});

describe("preflight", () => {
  it("passes an ECDSA account that can cover the fee and the escrow", async () => {
    const deps = mirror(account("ECDSA_SECP256K1", 20000000000));

    expect(await preflight({ payerAccountId: PAYER, feeTinybars: FEE, escrowTinybars: ESCROW }, deps))
      .toEqual({ ok: true });
  });

  it("refuses an ED25519 account, in the requester's words", async () => {
    const deps = mirror(account("ED25519", 20000000000));

    const result = await preflight({ payerAccountId: PAYER, feeTinybars: FEE }, deps);

    expect(result).toEqual({
      ok: false,
      reply:
        `Your account ${PAYER} uses an ED25519 key. ` +
        `The service fee needs an ECDSA account. Nothing was charged.`,
    });
  });

  it("refuses a balance that cannot cover fee plus escrow, naming both", async () => {
    // 42 HBAR, the design-system example.
    const deps = mirror(account("ECDSA_SECP256K1", 4200000000));

    const result = await preflight(
      { payerAccountId: PAYER, feeTinybars: FEE, escrowTinybars: ESCROW },
      deps,
    );

    expect(result).toEqual({
      ok: false,
      reply:
        "Your account holds 42 HBAR. Posting needs 0.5 HBAR for the fee plus " +
        "100 HBAR for escrow. Nothing was charged.",
    });
  });

  it("asks only for the fee when another account funds the escrow", async () => {
    const deps = mirror(account("ECDSA_SECP256K1", 10000000));

    const result = await preflight({ payerAccountId: PAYER, feeTinybars: FEE }, deps);

    expect(result).toEqual({
      ok: false,
      reply: "Your account holds 0.1 HBAR. Posting needs 0.5 HBAR for the fee. Nothing was charged.",
    });
  });

  it("passes exactly enough, because the boundary is not a shortfall", async () => {
    const deps = mirror(account("ECDSA_SECP256K1", 10050000000));

    expect(await preflight({ payerAccountId: PAYER, feeTinybars: FEE, escrowTinybars: ESCROW }, deps))
      .toEqual({ ok: true });
  });

  it("does not block when the mirror node is unreachable", async () => {
    // Being unable to check is not evidence of a problem. Blocking here would
    // turn a mirror outage into "you cannot order", and the facilitator still
    // refuses a bad payment without charging for it.
    const deps: PreflightDeps = {
      mirrorNodeUrl: MIRROR,
      async fetch() {
        throw new Error("down");
      },
    };

    expect(await preflight({ payerAccountId: PAYER, feeTinybars: FEE }, deps)).toEqual({ ok: true });
  });

  it("every refusal ends with the sentence that makes it safe to retry", async () => {
    const ed = await preflight({ payerAccountId: PAYER, feeTinybars: FEE }, mirror(account("ED25519", 1)));
    const poor = await preflight({ payerAccountId: PAYER, feeTinybars: FEE }, mirror(account("ECDSA_SECP256K1", 1)));

    for (const result of [ed, poor]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reply.endsWith("Nothing was charged.")).toBe(true);
    }
  });
});
