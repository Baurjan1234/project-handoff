import { describe, expect, it } from "vitest";
import { byteLength } from "./canonical.js";
import {
  ClaimEnvelope,
  compareConsensusTimestamps,
  decodeClaim,
  encodeClaim,
  parseConsensusTimestamp,
  resolveClaims,
  tryDecodeClaim,
  type ClaimRecord,
} from "./claim.js";
import { CERT_TAG_MAX_BYTES, HCS_MESSAGE_MAX_BYTES, ORDER_ID_MAX_BYTES, SCHEMA_VERSION } from "./constants.js";
import { encodeEnvelope, type OrderEnvelope } from "./envelope.js";
import { utcToEpochSeconds } from "./primitives.js";

const hash = (c: string) => c.repeat(64);

const claim = {
  kind: "claim",
  order_id: "order-1",
  cert_tag: "cpa-us",
  schema_version: SCHEMA_VERSION,
} as const;

const order: OrderEnvelope = {
  class: "review",
  order_id: "order-1",
  spec_hash: hash("1"),
  cert_tag: "cpa-us",
  price_tinybars: "10000000000",
  deadline: "2026-09-10T18:00:00Z",
  claim_timeout_seconds: 1800,
  schema_version: SCHEMA_VERSION,
  artifact_hash_in: hash("2"),
};

const DEADLINE = utcToEpochSeconds(order.deadline);
/** Posted well before the deadline, so the timeout is the binding window. */
const T0 = DEADLINE - 6 * 3600;

function record(
  payerAccountId: string,
  atEpochSeconds: number,
  overrides: Partial<ClaimRecord["claim"]> = {},
  nanos = "000000001",
): ClaimRecord {
  return {
    claim: { ...claim, ...overrides },
    payerAccountId,
    consensusTimestamp: `${atEpochSeconds}.${nanos}`,
    sequenceNumber: atEpochSeconds - T0,
  };
}

describe("shape", () => {
  it("accepts the four fields and nothing else", () => {
    expect(ClaimEnvelope.safeParse(claim).success).toBe(true);
    expect(ClaimEnvelope.safeParse({ ...claim, claimant: "0.0.5005" }).success).toBe(false);
  });

  it("carries no claimant and no timestamp, because the topic message does", () => {
    expect(Object.keys(ClaimEnvelope.shape).sort()).toEqual(["cert_tag", "kind", "order_id", "schema_version"]);
  });

  it("rejects the wrong kind, the wrong version, and a missing field", () => {
    expect(ClaimEnvelope.safeParse({ ...claim, kind: "order" }).success).toBe(false);
    expect(ClaimEnvelope.safeParse({ ...claim, schema_version: SCHEMA_VERSION + 1 }).success).toBe(false);
    const { cert_tag: _dropped, ...missing } = claim;
    expect(ClaimEnvelope.safeParse(missing).success).toBe(false);
  });

  it("cannot be parsed as an order, and an order cannot be parsed as a claim", () => {
    const orderBody = encodeEnvelope(order);
    expect(tryDecodeClaim(orderBody)).toBeNull();
    expect(tryDecodeClaim(encodeClaim(claim))).toEqual(claim);
  });

  it("treats a stray message on the public topic as not-a-claim, not as an error", () => {
    expect(tryDecodeClaim("not json")).toBeNull();
    expect(tryDecodeClaim('{"kind":"claim"}')).toBeNull();
  });
});

describe("encoding", () => {
  it("round-trips through canonical bytes", () => {
    expect(decodeClaim(encodeClaim(claim))).toEqual(claim);
  });

  it("is canonical regardless of key order", () => {
    const shuffled = { schema_version: SCHEMA_VERSION, cert_tag: "cpa-us", order_id: "order-1", kind: "claim" };
    expect(encodeClaim(shuffled)).toBe(encodeClaim(claim));
  });

  it("changes when any value changes", () => {
    expect(encodeClaim({ ...claim, order_id: "order-2" })).not.toBe(encodeClaim(claim));
  });

  it("fits in one HCS message with every field at its maximum", () => {
    const worst = {
      ...claim,
      order_id: "o".repeat(ORDER_ID_MAX_BYTES),
      cert_tag: "c".repeat(CERT_TAG_MAX_BYTES),
    };
    expect(byteLength(encodeClaim(worst))).toBeLessThanOrEqual(HCS_MESSAGE_MAX_BYTES);
  });

  it("stays small even at the bounds: 159 bytes, so a widened bound gets noticed here", () => {
    const worst = { ...claim, order_id: "o".repeat(ORDER_ID_MAX_BYTES), cert_tag: "c".repeat(CERT_TAG_MAX_BYTES) };
    expect(byteLength(encodeClaim(worst))).toBe(159);
  });
});

describe("consensus timestamps", () => {
  it("parses seconds.nanoseconds", () => {
    expect(parseConsensusTimestamp("1757000000.000000123")).toEqual({ seconds: 1_757_000_000n, nanos: 123 });
  });

  it("orders by seconds first, then nanoseconds, never lexically", () => {
    expect(compareConsensusTimestamps("9.5", "10.1")).toBeLessThan(0);
    expect(compareConsensusTimestamps("10.000000002", "10.000000001")).toBeGreaterThan(0);
    expect(compareConsensusTimestamps("10.1", "10.100000000")).toBe(0);
  });

  it("refuses anything that is not a consensus timestamp", () => {
    expect(() => parseConsensusTimestamp("2026-09-10T18:00:00Z")).toThrow(/seconds\.nanoseconds/);
    expect(() => parseConsensusTimestamp("10")).toThrow();
  });
});

describe("who holds the order", () => {
  it("is nobody when no claim has landed", () => {
    expect(resolveClaims({ order, claims: [], nowEpochSeconds: T0 })).toEqual({ state: "unclaimed" });
  });

  it("is the first claim by consensus timestamp, and the claimant is the payer", () => {
    const result = resolveClaims({
      order,
      claims: [record("0.0.7007", T0 + 10), record("0.0.5005", T0 + 5)],
      nowEpochSeconds: T0 + 20,
    });
    expect(result.state).toBe("claimed");
    if (result.state !== "claimed") return;
    expect(result.active.claimantAccountId).toBe("0.0.5005");
    expect(result.active.reopened).toBe(false);
  });

  it("decides a race on nanoseconds, not on the order the reader saw them", () => {
    const a = record("0.0.5005", T0 + 5, {}, "000000009");
    const b = record("0.0.7007", T0 + 5, {}, "000000008");
    const result = resolveClaims({ order, claims: [a, b], nowEpochSeconds: T0 + 6 });
    expect(result.state === "claimed" && result.active.claimantAccountId).toBe("0.0.7007");
  });

  it("sets sign-by to claim time plus the timeout", () => {
    const result = resolveClaims({ order, claims: [record("0.0.5005", T0 + 5)], nowEpochSeconds: T0 + 6 });
    expect(result.state === "claimed" && result.active.signByEpochSeconds).toBe(T0 + 5 + 1800);
  });

  it("never lets the window pass the order deadline", () => {
    const late = DEADLINE - 60;
    const result = resolveClaims({ order, claims: [record("0.0.5005", late)], nowEpochSeconds: late + 1 });
    expect(result.state === "claimed" && result.active.signByEpochSeconds).toBe(DEADLINE);
  });

  it("ignores a claim under the wrong credential", () => {
    const wrong = record("0.0.9009", T0 + 1, { cert_tag: "devops" });
    const right = record("0.0.5005", T0 + 2);
    const result = resolveClaims({ order, claims: [wrong, right], nowEpochSeconds: T0 + 3 });
    expect(result.state === "claimed" && result.active.claimantAccountId).toBe("0.0.5005");
  });

  it("ignores a claim for a different order", () => {
    const other = record("0.0.9009", T0 + 1, { order_id: "order-2" });
    expect(resolveClaims({ order, claims: [other], nowEpochSeconds: T0 + 2 })).toEqual({ state: "unclaimed" });
  });

  it("ignores a claim that landed at or after the deadline", () => {
    const tooLate = record("0.0.9009", DEADLINE);
    expect(resolveClaims({ order, claims: [tooLate], nowEpochSeconds: DEADLINE + 1 })).toEqual({ state: "unclaimed" });
  });

  it("reports claim-timeout once the window passes with nothing delivered", () => {
    const result = resolveClaims({ order, claims: [record("0.0.5005", T0)], nowEpochSeconds: T0 + 1800 });
    expect(result.state).toBe("claim_timeout");
    if (result.state !== "claim_timeout") return;
    expect(result.expired.claimantAccountId).toBe("0.0.5005");
    expect(result.reopenAvailable).toBe(true);
  });

  it("a delivered claim never expires", () => {
    const result = resolveClaims({
      order,
      claims: [record("0.0.5005", T0), record("0.0.7007", T0 + 5000)],
      nowEpochSeconds: T0 + 10_000,
      deliveredAt: `${T0 + 900}.000000001`,
    });
    expect(result.state === "claimed" && result.active.claimantAccountId).toBe("0.0.5005");
  });

  it("the first claim after expiry wins the reopen; a loser of the original race does not", () => {
    const winner = record("0.0.5005", T0);
    const loser = record("0.0.6006", T0 + 1);
    const reopener = record("0.0.7007", T0 + 1800);
    const result = resolveClaims({ order, claims: [winner, loser, reopener], nowEpochSeconds: T0 + 1801 });
    expect(result.state).toBe("claimed");
    if (result.state !== "claimed") return;
    expect(result.active.claimantAccountId).toBe("0.0.7007");
    expect(result.active.reopened).toBe(true);
    expect(result.active.signByEpochSeconds).toBe(T0 + 1800 + 1800);
  });

  it("reopens once: after the reopened claim expires, a third claim does not count", () => {
    const first = record("0.0.5005", T0);
    const second = record("0.0.7007", T0 + 1800);
    const third = record("0.0.8008", T0 + 3600);
    const result = resolveClaims({ order, claims: [first, second, third], nowEpochSeconds: T0 + 3601 });
    expect(result.state).toBe("claim_timeout");
    if (result.state !== "claim_timeout") return;
    expect(result.expired.claimantAccountId).toBe("0.0.7007");
    expect(result.reopenAvailable).toBe(false);
  });

  it("gives the same answer regardless of the order the reader received the messages", () => {
    const claims = [record("0.0.7007", T0 + 1800), record("0.0.5005", T0), record("0.0.6006", T0 + 1)];
    const forward = resolveClaims({ order, claims, nowEpochSeconds: T0 + 1801 });
    const reversed = resolveClaims({ order, claims: [...claims].reverse(), nowEpochSeconds: T0 + 1801 });
    expect(reversed).toEqual(forward);
  });
});
