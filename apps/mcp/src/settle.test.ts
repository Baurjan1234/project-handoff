import { describe, expect, it, vi } from "vitest";
import {
  encodeAttestation,
  encodeClaim,
  encodeEnvelope,
  MOCK_ESCROW_ACCOUNT_ID,
  MockChainAdapter,
  SCHEMA_VERSION,
  sha256Hex,
  type ChainAdapter,
} from "@handoff/schema";
import { SettleError, settleOrder, type SettleDeps } from "./settle.js";

const ORDERS = "0.0.orders";
const ATTESTATIONS = "0.0.attestations";
const EXPERT = "0.0.expert";
const PRICE = "10000000000";

const HASH = sha256Hex("FAKE report");
const OTHER_HASH = sha256Hex("a different FAKE report");

const DEADLINE = "2099-01-01T00:00:00Z";

function envelope(orderId: string, overrides: Record<string, unknown> = {}): string {
  return encodeEnvelope({
    order_id: orderId,
    class: "review",
    spec_hash: HASH,
    artifact_hash_in: HASH,
    cert_tag: "cpa-us",
    price_tinybars: PRICE,
    deadline: DEADLINE,
    claim_timeout_seconds: 3600,
    schema_version: SCHEMA_VERSION,
    ...overrides,
  });
}

function claim(orderId: string): string {
  return encodeClaim({
    kind: "claim",
    order_id: orderId,
    cert_tag: "cpa-us",
    schema_version: SCHEMA_VERSION,
  });
}

function attestation(orderId: string, overrides: Record<string, unknown> = {}): string {
  return encodeAttestation({
    order_id: orderId,
    class: "review",
    verdict: "approve",
    defects: [],
    notes_hash: HASH,
    artifact_hash_in: HASH,
    cert_tag: "cpa-us",
    schema_version: SCHEMA_VERSION,
    ...overrides,
  });
}

function deps(chain: ChainAdapter, overrides: Partial<SettleDeps> = {}): SettleDeps {
  return {
    chain,
    ordersTopicId: ORDERS,
    attestationsTopicId: ATTESTATIONS,
    escrowAccountId: MOCK_ESCROW_ACCOUNT_ID,
    ...overrides,
  };
}

/** POSTED → CLAIMED → DELIVERED, with the attestation submitted by the claimant. */
async function delivered(
  orderId: string,
  options: { attestationBody?: string; envelopeBody?: string; signer?: string } = {},
): Promise<MockChainAdapter> {
  const chain = new MockChainAdapter();
  await chain.submitMessage(ORDERS, options.envelopeBody ?? envelope(orderId));
  await chain.publishClaim(ORDERS, EXPERT, claim(orderId));
  // publishClaim is the mock's only way to submit as a named account, which is
  // what an attestation is: the expert pays, so the expert is the payer.
  await chain.publishClaim(
    ATTESTATIONS,
    options.signer ?? EXPERT,
    options.attestationBody ?? attestation(orderId),
  );
  return chain;
}

describe("settleOrder", () => {
  it("pays the claimant the order's price and reports the payout transaction", async () => {
    const chain = await delivered("ord_1");

    const settlement = await settleOrder("ord_1", deps(chain));

    expect(settlement.state).toBe("SETTLED");
    expect(settlement.payeeAccountId).toBe(EXPERT);
    // Byte for byte off the envelope. Nothing in the settle path converts money.
    expect(settlement.amountTinybars).toBe(PRICE);
    expect(settlement.payoutTransactionId).toBeTruthy();
  });

  it("pays a reject, because a reject is a delivered product (hard rule 3)", async () => {
    const chain = await delivered("ord_1", {
      attestationBody: attestation("ord_1", { verdict: "reject", defects: ["NO_MONITORING"] }),
    });

    const settlement = await settleOrder("ord_1", deps(chain));

    expect(settlement.state).toBe("SETTLED");
    expect(settlement.amountTinybars).toBe(PRICE);
  });

  it("is an idempotent retry — a second settle reaches the first payout rather than minting one", async () => {
    const chain = await delivered("ord_1");
    await settleOrder("ord_1", deps(chain));

    const second = await settleOrder("ord_1", deps(chain));

    // `alreadyRecorded` is the mock's `alreadyExisted`: the second settle
    // landed on the payout the first one created. It is a hint and not the
    // guarantee — the guarantee is the real adapter's mirror read, tested in
    // packages/chain, because this flag is false after a restart.
    expect(second.alreadyRecorded).toBe(true);
    // MockChainAdapter mints a fresh transaction id when it reports an
    // already-executed payout, where HederaChainAdapter returns the original
    // one. So this asserts the record, not the id: the ids are the real
    // adapter's to match, and packages/chain is where that is checked.
    expect(second.payoutTransactionId).toBeTruthy();
  });

  it("derives the payout's parameters from on-chain facts, so two settles mint one record", async () => {
    const chain = await delivered("ord_1");
    const createSchedule = vi.spyOn(chain, "createSchedule");

    await settleOrder("ord_1", deps(chain));
    const second = await settleOrder("ord_1", deps(chain));

    expect(createSchedule).toHaveBeenCalledTimes(2);
    // Identical parameters both times. A value taken from this process's clock
    // would differ here, and a differing parameter is a second payout: the
    // pending payout's id is a hash of exactly these fields.
    expect(createSchedule.mock.calls[0]?.[0]).toEqual(createSchedule.mock.calls[1]?.[0]);
    expect(second.alreadyRecorded).toBe(true);
  });

  it("refuses to pay on an attestation from an account that never held the claim", async () => {
    const chain = await delivered("ord_1", { signer: "0.0.impostor" });
    const createSchedule = vi.spyOn(chain, "createSchedule");

    await expect(settleOrder("ord_1", deps(chain))).rejects.toThrow(SettleError);
    // Not a violation: a stray message says nothing about whether the holder
    // delivered, so the order stays claimed and waits for the real one.
    await expect(settleOrder("ord_1", deps(chain))).rejects.toMatchObject({
      refusal: { kind: "not-ready", state: "CLAIMED" },
    });
    expect(createSchedule).not.toHaveBeenCalled();
  });

  it("still pays the holder when a stray attestation lands after theirs", async () => {
    const chain = await delivered("ord_1");
    await chain.publishClaim(ATTESTATIONS, "0.0.impostor", attestation("ord_1"));

    const settlement = await settleOrder("ord_1", deps(chain));

    // A stray one must not be able to shadow the real one, or anyone could
    // freeze any expert's payment for the price of one HCS message.
    expect(settlement.payeeAccountId).toBe(EXPERT);
  });

  it("calls a mismatched artifact hash a violation and moves no money", async () => {
    const chain = await delivered("ord_1", {
      attestationBody: attestation("ord_1", { artifact_hash_in: OTHER_HASH }),
    });
    const createSchedule = vi.spyOn(chain, "createSchedule");

    await expect(settleOrder("ord_1", deps(chain))).rejects.toMatchObject({
      refusal: { kind: "violation" },
    });
    expect(createSchedule).not.toHaveBeenCalled();
  });

  it("calls a mismatched cert tag a violation", async () => {
    const chain = await delivered("ord_1", {
      attestationBody: attestation("ord_1", { cert_tag: "pe-us" }),
    });

    await expect(settleOrder("ord_1", deps(chain))).rejects.toMatchObject({
      refusal: { kind: "violation" },
    });
  });

  it("refuses an unclaimed order — the payout is committed at claim, and there is nobody to pay", async () => {
    const chain = new MockChainAdapter();
    await chain.submitMessage(ORDERS, envelope("ord_1"));

    await expect(settleOrder("ord_1", deps(chain))).rejects.toMatchObject({
      refusal: { kind: "not-ready", state: "POSTED" },
    });
  });

  it("refuses a claimed order with no attestation yet, retryably", async () => {
    const chain = new MockChainAdapter();
    await chain.submitMessage(ORDERS, envelope("ord_1"));
    await chain.publishClaim(ORDERS, EXPERT, claim("ord_1"));

    await expect(settleOrder("ord_1", deps(chain))).rejects.toMatchObject({
      refusal: { kind: "not-ready", state: "CLAIMED" },
    });
  });

  it("answers UNKNOWN rather than guessing an order does not exist", async () => {
    const chain = new MockChainAdapter();

    await expect(settleOrder("ord_missing", deps(chain))).rejects.toMatchObject({
      refusal: { kind: "not-ready", state: "UNKNOWN" },
    });
  });

  it("lets a chain failure through rather than flattening it into 'could not settle'", async () => {
    const chain = await delivered("ord_1");
    vi.spyOn(chain, "signSchedule").mockRejectedValue(
      new Error("the payout was submitted as 0.0.1@2.3 and its outcome is unknown"),
    );

    // The message carries the transaction id of a payout whose outcome is
    // unknown, and that is the one thing the caller needs.
    await expect(settleOrder("ord_1", deps(chain))).rejects.toThrow(/outcome is unknown/);
  });
});
