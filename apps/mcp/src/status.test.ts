import { describe, expect, it } from "vitest";
import {
  encodeAttestation,
  encodeEnvelope,
  MockChainAdapter,
  SCHEMA_VERSION,
  sha256Hex,
} from "@handoff/schema";
import { readOrderStatus, type StatusDeps } from "./status.js";

const ORDERS = "0.0.orders";
const ATTESTATIONS = "0.0.attestations";

const HASH = sha256Hex("FAKE report");

function envelope(orderId: string): string {
  return encodeEnvelope({
    order_id: orderId,
    class: "review",
    spec_hash: HASH,
    artifact_hash_in: HASH,
    cert_tag: "cpa-us",
    price_tinybars: "10000000000",
    deadline: "2026-09-14T18:00:00Z",
    claim_timeout_seconds: 3600,
    schema_version: SCHEMA_VERSION,
  });
}

function attestation(orderId: string, verdict: string): string {
  return encodeAttestation({
    order_id: orderId,
    class: "review",
    verdict,
    defects: ["NO_MONITORING"],
    notes_hash: HASH,
    artifact_hash_in: HASH,
    cert_tag: "cpa-us",
    schema_version: SCHEMA_VERSION,
  });
}

function deps(chain: MockChainAdapter, overrides: Partial<StatusDeps> = {}): StatusDeps {
  return { chain, ordersTopicId: ORDERS, attestationsTopicId: ATTESTATIONS, ...overrides };
}

describe("readOrderStatus", () => {
  it("finds a posted order and carries its consensus timestamp", async () => {
    const chain = new MockChainAdapter();
    const submitted = await chain.submitMessage(ORDERS, envelope("ord_1"));

    const status = await readOrderStatus("ord_1", deps(chain));

    expect(status.state).toBe("POSTED");
    expect(status.postedAt).toBe(submitted.consensusTimestamp);
    expect(status.envelope?.cert_tag).toBe("cpa-us");
  });

  it("reports DELIVERED with the verdict and who signed once an attestation lands", async () => {
    const chain = new MockChainAdapter();
    await chain.submitMessage(ORDERS, envelope("ord_1"));
    const signed = await chain.submitMessage(ATTESTATIONS, attestation("ord_1", "reject"));

    const status = await readOrderStatus("ord_1", deps(chain));

    expect(status.state).toBe("DELIVERED");
    expect(status.verdict).toBe("reject");
    expect(status.signedAt).toBe(signed.consensusTimestamp);
    // The account that paid to submit the attestation is the expert's own.
    expect(status.signedBy).toBeTruthy();
  });

  it("answers UNKNOWN rather than guessing an order does not exist", async () => {
    const chain = new MockChainAdapter();

    const status = await readOrderStatus("ord_missing", deps(chain));

    // A mirror node runs about six seconds behind consensus, so a freshly
    // posted order reads this way and "it does not exist" would be a guess.
    expect(status.state).toBe("UNKNOWN");
    expect(status.envelope).toBeUndefined();
  });

  it("never claims to know whether a reviewer has claimed it", async () => {
    const chain = new MockChainAdapter();
    await chain.submitMessage(ORDERS, envelope("ord_1"));

    // There is a CLAIM lifecycle event but no on-wire claim message anywhere,
    // so a reader that reported CLAIMED would be inventing it.
    expect((await readOrderStatus("ord_1", deps(chain))).claimReadable).toBe(false);
  });

  it("walks past the first page, which is where the newest orders are", async () => {
    const chain = new MockChainAdapter();
    for (let i = 1; i <= 30; i += 1) {
      await chain.submitMessage(ORDERS, envelope(`ord_${i}`));
    }

    // A mirror node returns 25 by default and paginates through links.next. A
    // reader that stops at one page silently stops finding the newest orders,
    // which are exactly the ones anyone is asking about.
    const status = await readOrderStatus("ord_30", deps(chain, { pageSize: 25 }));

    expect(status.state).toBe("POSTED");
    expect(status.envelope?.order_id).toBe("ord_30");
  });

  it("ignores unparseable messages instead of failing the query", async () => {
    const chain = new MockChainAdapter();
    // Orders and attestations topics carry no submit key, on purpose, so
    // anybody can put anything on them. Noise is ordinary, not an error.
    await chain.submitMessage(ORDERS, "not json at all");
    await chain.submitMessage(ORDERS, JSON.stringify({ order_id: "ord_1" }));
    await chain.submitMessage(ORDERS, envelope("ord_1"));

    expect((await readOrderStatus("ord_1", deps(chain))).state).toBe("POSTED");
  });

  it("takes the later attestation when an order has more than one", async () => {
    const chain = new MockChainAdapter();
    await chain.submitMessage(ORDERS, envelope("ord_1"));
    await chain.submitMessage(ATTESTATIONS, attestation("ord_1", "approve"));
    await chain.submitMessage(ATTESTATIONS, attestation("ord_1", "reject"));

    // Consensus order is the truth, so the last one wins.
    expect((await readOrderStatus("ord_1", deps(chain))).verdict).toBe("reject");
  });
});
