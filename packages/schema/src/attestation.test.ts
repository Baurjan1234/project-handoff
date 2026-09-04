import { describe, expect, it } from "vitest";
import {
  Attestation,
  decodeAttestation,
  encodeAttestation,
  HcsSizeError,
} from "./attestation.js";
import { byteLength } from "./canonical.js";
import {
  CERT_TAG_MAX_BYTES,
  DEFECT_CODE_MAX_BYTES,
  DEFECTS_MAX_ITEMS,
  HCS_MESSAGE_MAX_BYTES,
  ORDER_ID_MAX_BYTES,
  SCHEMA_VERSION,
} from "./constants.js";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const hashC = "c".repeat(64);

const review = {
  class: "review",
  order_id: "order-1",
  verdict: "approve",
  defects: [],
  notes_hash: hashA,
  cert_tag: "cpa-us",
  schema_version: SCHEMA_VERSION,
  artifact_hash_in: hashB,
} as const;

const execution = {
  class: "execution",
  order_id: "order-2",
  verdict: "approve",
  defects: [],
  notes_hash: hashA,
  cert_tag: "devops",
  schema_version: SCHEMA_VERSION,
  artifact_hash_out: hashC,
} as const;

describe("the class rule", () => {
  it("accepts a review with only an input hash", () => {
    expect(Attestation.safeParse(review).success).toBe(true);
  });

  it("rejects a review carrying an output hash", () => {
    const result = Attestation.safeParse({ ...review, artifact_hash_out: hashC });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe("unrecognized_keys");
  });

  it("accepts an execution with only an output hash", () => {
    expect(Attestation.safeParse(execution).success).toBe(true);
  });

  it("accepts an execution with both hashes, when an input existed", () => {
    expect(Attestation.safeParse({ ...execution, artifact_hash_in: hashB }).success).toBe(true);
  });

  it("rejects an execution missing its output hash", () => {
    const { artifact_hash_out: _dropped, ...missing } = execution;
    expect(Attestation.safeParse(missing).success).toBe(false);
  });

  it("rejects a review missing its input hash", () => {
    const { artifact_hash_in: _dropped, ...missing } = review;
    expect(Attestation.safeParse(missing).success).toBe(false);
  });

  it("rejects an unknown class", () => {
    expect(Attestation.safeParse({ ...review, class: "redline" }).success).toBe(false);
  });

  it("rejects any other stray key, so a typo is never silently dropped", () => {
    expect(Attestation.safeParse({ ...review, artifcat_hash_in: hashB }).success).toBe(false);
  });

  it("makes the wrong shape a type error, not only a parse error", () => {
    // @ts-expect-error a review has no artifact_hash_out
    const bad: Attestation = { ...review, artifact_hash_out: hashC };
    expect(Attestation.safeParse(bad).success).toBe(false);
  });
});

describe("hashes", () => {
  it.each(["A".repeat(64), "a".repeat(63), "a".repeat(65), "", "0x" + "a".repeat(62), "g".repeat(64)])(
    "rejects %o as a hash",
    (bad) => {
      expect(Attestation.safeParse({ ...review, notes_hash: bad }).success).toBe(false);
    },
  );
});

describe("bounds", () => {
  it("accepts defects at the limit", () => {
    const defects = Array.from({ length: DEFECTS_MAX_ITEMS }, (_, i) => `D${i}`);
    expect(Attestation.safeParse({ ...review, defects }).success).toBe(true);
  });

  it("rejects one defect past the limit", () => {
    const defects = Array.from({ length: DEFECTS_MAX_ITEMS + 1 }, (_, i) => `D${i}`);
    expect(Attestation.safeParse({ ...review, defects }).success).toBe(false);
  });

  it("rejects a defect code that is too long, counting bytes not characters", () => {
    const tooLong = "é".repeat(DEFECT_CODE_MAX_BYTES); // two bytes each
    expect(Attestation.safeParse({ ...review, defects: [tooLong] }).success).toBe(false);
  });

  it("rejects an empty defect code", () => {
    expect(Attestation.safeParse({ ...review, defects: [""] }).success).toBe(false);
  });

  it("rejects a wrong schema_version", () => {
    expect(Attestation.safeParse({ ...review, schema_version: 2 }).success).toBe(false);
  });
});

describe("HCS size", () => {
  it("the bounds guarantee the worst case fits in one message", () => {
    // Every field at its maximum. If someone widens a bound without checking,
    // this fails rather than a demo failing on testnet.
    const worst = {
      class: "execution",
      order_id: "o".repeat(ORDER_ID_MAX_BYTES),
      verdict: "approve_with_changes",
      defects: Array.from({ length: DEFECTS_MAX_ITEMS }, () => "d".repeat(DEFECT_CODE_MAX_BYTES)),
      notes_hash: hashA,
      cert_tag: "c".repeat(CERT_TAG_MAX_BYTES),
      schema_version: SCHEMA_VERSION,
      prior_attestation_ref: hashA,
      artifact_hash_in: hashB,
      artifact_hash_out: hashC,
    };

    const encoded = encodeAttestation(worst);
    expect(byteLength(encoded)).toBeLessThanOrEqual(HCS_MESSAGE_MAX_BYTES);
  });

  it("exports the error the verifier catches", () => {
    expect(new HcsSizeError("x")).toBeInstanceOf(Error);
  });
});

describe("encode and decode", () => {
  it("is canonical, so key order in the caller cannot change the bytes", () => {
    const reordered = {
      artifact_hash_in: review.artifact_hash_in,
      schema_version: review.schema_version,
      cert_tag: review.cert_tag,
      notes_hash: review.notes_hash,
      defects: review.defects,
      verdict: review.verdict,
      order_id: review.order_id,
      class: review.class,
    };
    expect(encodeAttestation(reordered)).toBe(encodeAttestation(review));
  });

  it("omits an absent optional rather than writing null", () => {
    expect(encodeAttestation(review)).not.toContain("prior_attestation_ref");
  });

  it("treats an explicitly undefined optional as absent", () => {
    expect(encodeAttestation({ ...review, prior_attestation_ref: undefined })).toBe(
      encodeAttestation(review),
    );
  });

  it("round trips through a mirror node read", () => {
    expect(decodeAttestation(encodeAttestation(review))).toEqual(review);
  });

  it("refuses to encode an invalid attestation at all", () => {
    expect(() => encodeAttestation({ ...review, artifact_hash_out: hashC })).toThrow();
  });
});
