import { describe, expect, it } from "vitest";
import { ReviewOrder, SCHEMA_VERSION, type ClaimRecord, type TopicMessage } from "@handoff/schema";
import { claimBody, claimRecordsFor, claimStateFor, confirmClaim } from "./claim";

const TOPIC = "MOCK-topic-orders";
const EXPERT = "0.0.12345";
const RIVAL = "0.0.99999";

/** Deadline 2026-09-14. Claims below land on 2026-09-08, well inside it. */
const order = ReviewOrder.parse({
  order_id: "ord",
  class: "review",
  spec_hash: "a".repeat(64),
  artifact_hash_in: "b".repeat(64),
  cert_tag: "demo-reviewer",
  price_tinybars: "10000000000",
  deadline: "2026-09-14T00:00:00Z",
  claim_timeout_seconds: 1800,
  schema_version: SCHEMA_VERSION,
});
const other = { ...order, order_id: "other" };

/** 2026-09-08T12:00:00Z, as seconds. */
const T0 = Date.UTC(2026, 8, 8, 12, 0, 0) / 1000;
const at = (seconds: number, nanos = 0): string => `${T0 + seconds}.${String(nanos).padStart(9, "0")}`;

function message(sequenceNumber: number, consensusTimestamp: string, payerAccountId: string, contents: string): TopicMessage {
  return { topicId: TOPIC, sequenceNumber, consensusTimestamp, payerAccountId, contents };
}

describe("claimBody", () => {
  it("is the treaty's claim: order, credential, version, and no claimant in the body", () => {
    expect(JSON.parse(claimBody(order))).toEqual({ kind: "claim", order_id: "ord", cert_tag: "demo-reviewer", schema_version: 1 });
  });
});

describe("claimRecordsFor", () => {
  it("keeps only claims for the order, takes the claimant from the payer, and orders by consensus time", () => {
    const records = claimRecordsFor(
      [
        message(1, at(0, 5), "MOCK-payer", "{not json"),
        message(2, at(0, 9), RIVAL, claimBody(other)),
        message(3, at(0, 20), EXPERT, claimBody(order)),
        message(4, at(0, 10), RIVAL, claimBody(order)),
      ],
      "ord",
    );
    expect(records.map((r) => r.payerAccountId)).toEqual([RIVAL, EXPERT]);
    expect(records[0]?.sequenceNumber).toBe(4);
  });
});

describe("claimStateFor", () => {
  const mine: ClaimRecord = {
    claim: { kind: "claim", order_id: "ord", cert_tag: "demo-reviewer", schema_version: SCHEMA_VERSION },
    payerAccountId: EXPERT,
    consensusTimestamp: at(1),
    sequenceNumber: 2,
  };
  const theirs: ClaimRecord = { ...mine, payerAccountId: RIVAL, consensusTimestamp: at(0), sequenceNumber: 1 };

  it("is open with no claims", () => {
    expect(claimStateFor(order, [], EXPERT, T0)).toEqual({ kind: "open" });
  });

  it("is yours when ours holds it, with the sign-by time from the network's clock", () => {
    expect(claimStateFor(order, [mine], EXPERT, T0 + 2)).toEqual({
      kind: "yours",
      claimedAtEpochSeconds: T0 + 1,
      signBy: "2026-09-08T12:30:01Z",
    });
  });

  it("is someone else's when an earlier claim holds it", () => {
    // The holder's window and whether this expert tried, both from the topic.
    expect(claimStateFor(order, [theirs, mine], EXPERT, T0 + 2)).toEqual({
      kind: "someone-else",
      holderSignBy: "2026-09-08T12:30:00Z",
      youClaimed: true,
    });
    expect(claimStateFor(order, [theirs], EXPERT, T0 + 2)).toEqual({
      kind: "someone-else",
      holderSignBy: "2026-09-08T12:30:00Z",
      youClaimed: false,
    });
  });

  it("reopens once after the window expires, then closes", () => {
    expect(claimStateFor(order, [theirs], EXPERT, T0 + 1800)).toEqual({ kind: "open" });
    const reopened = { ...mine, consensusTimestamp: at(1801), sequenceNumber: 3 };
    expect(claimStateFor(order, [theirs, reopened], EXPERT, T0 + 1802).kind).toBe("yours");
    expect(claimStateFor(order, [theirs, reopened], EXPERT, T0 + 1801 + 1800)).toEqual({ kind: "closed" });
  });
});

describe("confirmClaim", () => {
  function clock() {
    let t = (T0 + 3) * 1000;
    return {
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
    };
  }

  const submitted = { transactionId: "MOCK-tx-9", consensusTimestamp: at(2), sequenceNumber: 2 };
  const base = (reader: { readMessages: () => Promise<readonly TopicMessage[]> }) => ({
    topicId: TOPIC,
    order,
    expertAccountId: EXPERT,
    submitted,
    reader,
  });

  it("stays Confirming until the mirror shows our message, then it is yours", async () => {
    let reads = 0;
    const reader = {
      readMessages: async () => (++reads < 3 ? [] : [message(2, submitted.consensusTimestamp, EXPERT, claimBody(order))]),
    };
    const phases: string[] = [];
    const final = await confirmClaim({ ...base(reader), onChange: (s) => phases.push(s.phase) }, clock());
    expect(final.phase).toBe("yours");
    expect(final.state?.kind).toBe("yours");
    expect(phases.slice(0, -1).every((p) => p === "confirming")).toBe(true);
    expect(final.claimTransactionId).toBe("MOCK-tx-9");
  });

  it("loses to an earlier claim the mirror confirms, as an ordinary outcome", async () => {
    const reader = {
      readMessages: async () => [
        message(1, at(1), RIVAL, claimBody(order)),
        message(2, submitted.consensusTimestamp, EXPERT, claimBody(order)),
      ],
    };
    const final = await confirmClaim(base(reader), clock());
    expect(final.phase).toBe("someone-else");
    expect(final.state?.kind).toBe("someone-else");
  });

  it("decides on an earlier claim even before the mirror shows ours", async () => {
    const reader = { readMessages: async () => [message(1, at(1), RIVAL, claimBody(order))] };
    const final = await confirmClaim(base(reader), clock());
    expect(final.phase).toBe("someone-else");
  });

  it("ignores a claim under the wrong credential, as the treaty says", async () => {
    const wrongTag = claimBody({ ...order, cert_tag: "someone-elses-tag" });
    const reader = {
      readMessages: async () => [message(1, at(1), RIVAL, wrongTag), message(2, submitted.consensusTimestamp, EXPERT, claimBody(order))],
    };
    const final = await confirmClaim(base(reader), clock());
    expect(final.phase).toBe("yours");
  });

  it("treats a throwing read as not-yet and stalls with the error after the limit", async () => {
    const reader = {
      readMessages: async () => {
        throw new Error("503 from the mirror");
      },
    };
    const final = await confirmClaim(base(reader), { ...clock(), giveUpAfterMs: 5_000, intervalMs: 1_000 });
    expect(final.phase).toBe("stalled");
    expect(final.lastReadError).toBe("503 from the mirror");
    expect(final.elapsedMs).toBe(5_000);
  });
});
