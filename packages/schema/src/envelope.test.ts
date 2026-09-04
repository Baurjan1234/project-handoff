import { describe, expect, it } from "vitest";
import { byteLength } from "./canonical.js";
import {
  CLAIM_TIMEOUT_MAX_SECONDS,
  CLAIM_TIMEOUT_MIN_SECONDS,
  HCS_MESSAGE_MAX_BYTES,
  ORDER_ID_MAX_BYTES,
  SCHEMA_VERSION,
} from "./constants.js";
import {
  assertClaimTimeoutFitsWindow,
  decodeEnvelope,
  encodeEnvelope,
  EnvelopeError,
  OrderEnvelope,
} from "./envelope.js";
import { utcToEpochSeconds } from "./primitives.js";

const hash = (c: string) => c.repeat(64);

const review = {
  class: "review",
  order_id: "order-1",
  spec_hash: hash("1"),
  cert_tag: "cpa-us",
  price_tinybars: "20000000000",
  deadline: "2026-09-14T00:00:00Z",
  claim_timeout_seconds: 1800,
  schema_version: SCHEMA_VERSION,
  artifact_hash_in: hash("2"),
} as const;

const execution = {
  class: "execution",
  order_id: "order-2",
  spec_hash: hash("1"),
  cert_tag: "devops",
  price_tinybars: "20000000000",
  deadline: "2026-09-14T00:00:00Z",
  claim_timeout_seconds: 1800,
  schema_version: SCHEMA_VERSION,
  acceptance_hash: hash("3"),
} as const;

describe("class rules", () => {
  it("accepts a review with an input to review", () => {
    expect(OrderEnvelope.safeParse(review).success).toBe(true);
  });

  it("rejects a review with nothing to review", () => {
    const { artifact_hash_in: _dropped, ...missing } = review;
    expect(OrderEnvelope.safeParse(missing).success).toBe(false);
  });

  it("rejects a review carrying acceptance criteria, which only execution has", () => {
    expect(OrderEnvelope.safeParse({ ...review, acceptance_hash: hash("3") }).success).toBe(false);
  });

  it("accepts an execution starting from nothing", () => {
    expect(OrderEnvelope.safeParse(execution).success).toBe(true);
  });

  it("accepts an execution starting from something half-finished", () => {
    expect(OrderEnvelope.safeParse({ ...execution, artifact_hash_in: hash("2") }).success).toBe(
      true,
    );
  });

  it("rejects an execution with no acceptance criteria, which could never settle", () => {
    const { acceptance_hash: _dropped, ...missing } = execution;
    expect(OrderEnvelope.safeParse(missing).success).toBe(false);
  });

  it("rejects a stray key rather than dropping it", () => {
    expect(OrderEnvelope.safeParse({ ...review, artifcat_hash_in: hash("2") }).success).toBe(false);
  });
});

describe("price", () => {
  it.each(["0", "-1", "1.5", "200", "1e5", "", "0x10", " 1"])("rejects or accepts %o", (value) => {
    const ok = OrderEnvelope.safeParse({ ...review, price_tinybars: value }).success;
    expect(ok).toBe(value === "200");
  });

  it("is a tinybar integer string, not HBAR", () => {
    expect(OrderEnvelope.safeParse({ ...review, price_tinybars: "20000000000" }).success).toBe(
      true,
    );
  });
});

describe("deadline", () => {
  it.each([
    "2026-09-14T00:00:00+08:00",
    "2026-09-14T00:00:00.000Z",
    "2026-09-14T00:00:00",
    "2026-09-14",
    "2026-13-01T00:00:00Z",
  ])("rejects %o, because two encodings of one moment give two hashes", (deadline) => {
    expect(OrderEnvelope.safeParse({ ...review, deadline }).success).toBe(false);
  });

  it("accepts a Z-suffixed instant at second precision", () => {
    expect(OrderEnvelope.safeParse({ ...review, deadline: "2026-09-14T00:00:00Z" }).success).toBe(
      true,
    );
  });
});

describe("claim timeout", () => {
  it("accepts the bounds", () => {
    for (const s of [CLAIM_TIMEOUT_MIN_SECONDS, CLAIM_TIMEOUT_MAX_SECONDS]) {
      expect(OrderEnvelope.safeParse({ ...review, claim_timeout_seconds: s }).success).toBe(true);
    }
  });

  it("rejects one past either bound, and anything fractional", () => {
    for (const s of [CLAIM_TIMEOUT_MIN_SECONDS - 1, CLAIM_TIMEOUT_MAX_SECONDS + 1, 1800.5, 0]) {
      expect(OrderEnvelope.safeParse({ ...review, claim_timeout_seconds: s }).success).toBe(false);
    }
  });
});

describe("assertClaimTimeoutFitsWindow", () => {
  const deadline = utcToEpochSeconds(review.deadline);

  it("allows a timeout at exactly a third of the window", () => {
    const postedAt = deadline - review.claim_timeout_seconds * 3;
    expect(() => assertClaimTimeoutFitsWindow(postedAt, review)).not.toThrow();
  });

  it("refuses a timeout that eats too much of the window", () => {
    const postedAt = deadline - review.claim_timeout_seconds * 2;
    expect(() => assertClaimTimeoutFitsWindow(postedAt, review)).toThrow(EnvelopeError);
  });

  it("refuses a deadline that has already passed", () => {
    expect(() => assertClaimTimeoutFitsWindow(deadline + 1, review)).toThrow(/not in the future/);
  });

  it("explains why the two events are separate", () => {
    const postedAt = deadline - review.claim_timeout_seconds;
    expect(() => assertClaimTimeoutFitsWindow(postedAt, review)).toThrow(/hold\s+funds hostage/);
  });
});

describe("encode and decode", () => {
  it("is canonical, so caller key order cannot change the bytes", () => {
    const reordered = {
      schema_version: review.schema_version,
      artifact_hash_in: review.artifact_hash_in,
      claim_timeout_seconds: review.claim_timeout_seconds,
      deadline: review.deadline,
      price_tinybars: review.price_tinybars,
      cert_tag: review.cert_tag,
      spec_hash: review.spec_hash,
      order_id: review.order_id,
      class: review.class,
    };
    expect(encodeEnvelope(reordered)).toBe(encodeEnvelope(review));
  });

  it("round trips through a mirror node read", () => {
    expect(decodeEnvelope(encodeEnvelope(execution))).toEqual(execution);
  });

  it("treats an explicitly undefined optional as absent", () => {
    expect(encodeEnvelope({ ...execution, artifact_hash_in: undefined })).toBe(
      encodeEnvelope(execution),
    );
  });

  it("the worst case fits in one HCS message", () => {
    const worst = {
      ...execution,
      order_id: "o".repeat(ORDER_ID_MAX_BYTES),
      artifact_hash_in: hash("2"),
      claim_timeout_seconds: CLAIM_TIMEOUT_MAX_SECONDS,
      price_tinybars: "9223372036854775807",
    };
    expect(byteLength(encodeEnvelope(worst))).toBeLessThanOrEqual(HCS_MESSAGE_MAX_BYTES);
  });
});
