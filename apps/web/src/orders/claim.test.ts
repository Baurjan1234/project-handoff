import { describe, expect, it } from "vitest";
import type { TopicMessage } from "@handoff/schema";
import { claimsFor, claimStateFor, compareTimestamps, confirmClaim, decodeClaim, encodeClaim } from "./claim";

const TOPIC = "MOCK-topic-orders";
const EXPERT = "0.0.12345";
const RIVAL = "0.0.99999";
const DEADLINE = "2026-09-14T00:00:00Z";

function message(sequenceNumber: number, consensusTimestamp: string, contents: string): TopicMessage {
  return { topicId: TOPIC, sequenceNumber, consensusTimestamp, payerAccountId: "MOCK-payer", contents };
}

describe("decodeClaim", () => {
  it("round-trips, and refuses an extra field, a missing one, or another version", () => {
    const encoded = encodeClaim("ord", EXPERT);
    expect(decodeClaim(JSON.parse(encoded))).toEqual({ kind: "claim", order_id: "ord", claimant: EXPERT, schema_version: 1 });
    expect(decodeClaim({ ...JSON.parse(encoded), extra: 1 })).toBeNull();
    expect(decodeClaim({ kind: "claim", order_id: "ord", claimant: EXPERT })).toBeNull();
    expect(decodeClaim({ ...JSON.parse(encoded), schema_version: 2 })).toBeNull();
    expect(decodeClaim("claim")).toBeNull();
  });
});

describe("claimsFor", () => {
  it("keeps only claims for the order, in consensus order, ignoring anything unparsable", () => {
    const claims = claimsFor(
      [
        message(1, "100.000000005", "{not json"),
        message(2, "100.000000009", encodeClaim("other", RIVAL)),
        message(3, "100.000000020", encodeClaim("ord", EXPERT)),
        message(4, "100.000000010", encodeClaim("ord", RIVAL)),
      ],
      "ord",
    );
    expect(claims.map((c) => c.claimant)).toEqual([RIVAL, EXPERT]);
  });

  it("compares timestamps as numbers, so 9 nanoseconds is before 10", () => {
    expect(compareTimestamps("100.000000009", "100.000000010")).toBeLessThan(0);
    expect(compareTimestamps("101.000000000", "100.999999999")).toBeGreaterThan(0);
  });
});

describe("claimStateFor", () => {
  it("is open with no claims, yours when ours is first, someone-else otherwise", () => {
    expect(claimStateFor([], EXPERT, 1800, DEADLINE)).toEqual({ kind: "open" });
    const mine = { claimant: EXPERT, consensusTimestamp: "1757000000.000000001", sequenceNumber: 2 };
    const theirs = { claimant: RIVAL, consensusTimestamp: "1757000000.000000000", sequenceNumber: 1 };
    expect(claimStateFor([mine], EXPERT, 1800, DEADLINE)).toMatchObject({
      kind: "yours",
      claimedAtEpochSeconds: 1757000000,
      signBy: "2025-09-04T16:03:20Z",
    });
    expect(claimStateFor([theirs, mine], EXPERT, 1800, DEADLINE)).toEqual({ kind: "someone-else" });
  });
});

describe("confirmClaim", () => {
  function clock() {
    let t = 0;
    return {
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
    };
  }

  const submitted = { transactionId: "MOCK-tx-9", consensusTimestamp: "1757000000.000000002", sequenceNumber: 2 };
  const base = (reader: { readMessages: () => Promise<readonly TopicMessage[]> }) => ({
    topicId: TOPIC,
    orderId: "ord",
    expertAccountId: EXPERT,
    claimTimeoutSeconds: 1800,
    deadline: DEADLINE,
    submitted,
    reader,
  });

  it("stays Confirming until the mirror shows our message, then it is yours", async () => {
    let reads = 0;
    const reader = {
      readMessages: async () =>
        ++reads < 3 ? [] : [message(2, submitted.consensusTimestamp, encodeClaim("ord", EXPERT))],
    };
    const phases: string[] = [];
    const c = clock();
    const final = await confirmClaim({ ...base(reader), onChange: (s) => phases.push(s.phase) }, c);
    expect(final.phase).toBe("yours");
    expect(final.state?.kind).toBe("yours");
    expect(phases.slice(0, -1).every((p) => p === "confirming")).toBe(true);
    expect(final.claimTransactionId).toBe("MOCK-tx-9");
  });

  it("loses to an earlier claim the mirror confirms, as an ordinary outcome", async () => {
    const reader = {
      readMessages: async () => [
        message(1, "1757000000.000000001", encodeClaim("ord", RIVAL)),
        message(2, submitted.consensusTimestamp, encodeClaim("ord", EXPERT)),
      ],
    };
    const final = await confirmClaim(base(reader), clock());
    expect(final.phase).toBe("someone-else");
  });

  it("decides on an earlier claim even before the mirror shows ours", async () => {
    const reader = {
      readMessages: async () => [message(1, "1757000000.000000001", encodeClaim("ord", RIVAL))],
    };
    const final = await confirmClaim(base(reader), clock());
    expect(final.phase).toBe("someone-else");
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
