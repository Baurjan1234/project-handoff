/**
 * Property-based tests.
 *
 * The example tests elsewhere check the cases we thought of. These check
 * thousands we did not, which is the point: the money and hashing modules are
 * where an unimagined input costs somebody real money, and where a test written
 * by the same author as the code inherits that author's blind spots.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { encodeAttestation } from "./attestation.js";
import { byteLength, canonicalize, hashCanonical } from "./canonical.js";
import {
  CERT_TAG_MAX_BYTES,
  DEFECT_CODE_MAX_BYTES,
  DEFECTS_MAX_ITEMS,
  HCS_MESSAGE_MAX_BYTES,
  ORDER_ID_MAX_BYTES,
  SCHEMA_VERSION,
} from "./constants.js";
import {
  formatTinybars,
  hbarToTinybars,
  MAX_TINYBARS,
  MIN_TINYBARS,
  MoneyError,
  parseTinybars,
  tinybarsToHbar,
} from "./money.js";

const tinybars = fc.bigInt({ min: MIN_TINYBARS, max: MAX_TINYBARS });

/** Trim to a byte budget without splitting a code point. */
function trimToBytes(value: string, maxBytes: number): string {
  const points = [...value];
  while (points.length > 0 && byteLength(points.join("")) > maxBytes) points.pop();
  return points.join("");
}

/** Typical text within a byte budget. Mostly small, as fast-check prefers. */
const boundedText = (maxBytes: number) =>
  fc
    .string({ unit: "grapheme", minLength: 1, maxLength: maxBytes })
    .map((value) => trimToBytes(value, maxBytes))
    .filter((value) => value.length > 0);

/**
 * Text that actually reaches the byte budget.
 *
 * Needed because fast-check biases toward small values: measured over two
 * thousand samples, the unbiased generator produced attestations no larger than
 * 774 bytes against a 1024-byte limit, so the size property was passing without
 * ever approaching the boundary it claims to defend.
 */
const maxedText = (maxBytes: number) =>
  fc
    .string({ unit: "grapheme", minLength: maxBytes, maxLength: maxBytes * 2 })
    .map((value) => trimToBytes(value, maxBytes))
    .filter((value) => byteLength(value) >= maxBytes - 3);

const sha256Hex = fc.stringMatching(/^[0-9a-f]{64}$/);

describe("money round trips", () => {
  it("survives the wire form for any amount in range", () => {
    fc.assert(
      fc.property(tinybars, (t) => {
        expect(parseTinybars(formatTinybars(t))).toBe(t);
      }),
    );
  });

  it("survives the human form for any amount in range", () => {
    fc.assert(
      fc.property(tinybars, (t) => {
        expect(hbarToTinybars(tinybarsToHbar(t))).toBe(t);
      }),
    );
  });

  it("always renders a canonical decimal: no leading zeros, no trailing zeros", () => {
    fc.assert(
      fc.property(tinybars, (t) => {
        expect(tinybarsToHbar(t)).toMatch(/^-?(0|[1-9]\d*)(\.\d*[1-9])?$/);
      }),
    );
  });

  it("keeps the sign", () => {
    fc.assert(
      fc.property(tinybars, (t) => {
        expect(tinybarsToHbar(t).startsWith("-")).toBe(t < 0n);
      }),
    );
  });

  it("refuses everything above the int64 maximum", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: MAX_TINYBARS + 1n, max: MAX_TINYBARS * 4n }), (t) => {
        expect(() => formatTinybars(t)).toThrow(MoneyError);
      }),
    );
  });

  it("refuses everything below the int64 minimum", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: MIN_TINYBARS * 4n, max: MIN_TINYBARS - 1n }), (t) => {
        expect(() => formatTinybars(t)).toThrow(MoneyError);
      }),
    );
  });

  it("accepts both extremes, which are not symmetric", () => {
    // The first version of the property above negated an over-maximum value and
    // expected it to fail. It did not: int64's minimum is one further from zero
    // than its maximum, so negating max + 1 lands exactly on a valid amount.
    // The assumption was wrong, not the code, which is the point of generating
    // inputs rather than choosing them.
    expect(MIN_TINYBARS).toBe(-(MAX_TINYBARS + 1n));
    expect(formatTinybars(MAX_TINYBARS)).toBe(MAX_TINYBARS.toString());
    expect(formatTinybars(MIN_TINYBARS)).toBe(MIN_TINYBARS.toString());
  });

  it("never accepts a string it did not produce", () => {
    fc.assert(
      fc.property(fc.string(), (junk) => {
        // Anything parseTinybars accepts must round trip exactly.
        try {
          const parsed = parseTinybars(junk);
          expect(formatTinybars(parsed)).toBe(junk);
        } catch (error) {
          expect(error).toBeInstanceOf(MoneyError);
        }
      }),
    );
  });
});

/** Values our canonicalization is defined over: no floats, no undefined, no exotics. */
const jsonValue = fc.letrec<{ value: unknown }>((tie) => ({
  value: fc.oneof(
    { maxDepth: 3 },
    fc.string({ unit: "grapheme" }),
    fc.boolean(),
    fc.constant(null),
    fc.integer(),
    fc.array(tie("value"), { maxLength: 4 }),
    fc.dictionary(fc.string({ unit: "grapheme" }), tie("value"), { maxKeys: 5 }),
  ),
})).value;

/** Rebuild an object with its keys inserted in a different order. */
function reinsert(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reinsert);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).reverse();
    return Object.fromEntries(entries.map(([k, v]) => [k, reinsert(v)]));
  }
  return value;
}

describe("canonicalization properties", () => {
  it("ignores key insertion order, which is the whole reason it exists", () => {
    fc.assert(
      fc.property(jsonValue, (value) => {
        expect(canonicalize(reinsert(value))).toBe(canonicalize(value));
      }),
    );
  });

  it("emits valid JSON that parses back to the same value", () => {
    fc.assert(
      fc.property(jsonValue, (value) => {
        expect(JSON.parse(canonicalize(value))).toEqual(value);
      }),
    );
  });

  it("is a fixed point: canonicalizing its own output changes nothing", () => {
    fc.assert(
      fc.property(jsonValue, (value) => {
        const once = canonicalize(value);
        expect(canonicalize(JSON.parse(once))).toBe(once);
      }),
    );
  });

  it("always hashes to 64 lowercase hex characters", () => {
    fc.assert(
      fc.property(jsonValue, (value) => {
        expect(hashCanonical(value)).toMatch(/^[0-9a-f]{64}$/);
      }),
    );
  });
});

describe("every attestation the schema accepts fits in one HCS message", () => {
  const shape = (
    text: (n: number) => fc.Arbitrary<string>,
    defects: fc.Arbitrary<string[]>,
  ) =>
    fc
    .record({
      order_id: text(ORDER_ID_MAX_BYTES),
      cert_tag: text(CERT_TAG_MAX_BYTES),
      verdict: fc.constantFrom("approve", "approve_with_changes", "reject"),
      defects,
      notes_hash: sha256Hex,
      in_hash: sha256Hex,
      out_hash: sha256Hex,
      prior: fc.option(sha256Hex, { nil: undefined }),
      isExecution: fc.boolean(),
      hasInput: fc.boolean(),
    })
    .map(({ isExecution, hasInput, in_hash, out_hash, prior, ...rest }) =>
      isExecution
        ? {
            ...rest,
            class: "execution" as const,
            schema_version: SCHEMA_VERSION,
            artifact_hash_out: out_hash,
            ...(hasInput ? { artifact_hash_in: in_hash } : {}),
            ...(prior === undefined ? {} : { prior_attestation_ref: prior }),
          }
        : {
            ...rest,
            class: "review" as const,
            schema_version: SCHEMA_VERSION,
            artifact_hash_in: in_hash,
            ...(prior === undefined ? {} : { prior_attestation_ref: prior }),
          },
    );

  const typical = shape(boundedText, fc.array(boundedText(DEFECT_CODE_MAX_BYTES), {
    maxLength: DEFECTS_MAX_ITEMS,
  }));

  /** Every field at or near its ceiling, which is where the limit is actually at risk. */
  const maximal = shape(maxedText, fc.array(maxedText(DEFECT_CODE_MAX_BYTES), {
    minLength: DEFECTS_MAX_ITEMS,
    maxLength: DEFECTS_MAX_ITEMS,
  }));

  it("holds for typical attestations", () => {
    fc.assert(
      fc.property(typical, (value) => {
        expect(byteLength(encodeAttestation(value))).toBeLessThanOrEqual(HCS_MESSAGE_MAX_BYTES);
      }),
      { numRuns: 500 },
    );
  });

  it("holds at the ceiling, where the bounds are actually load-bearing", () => {
    fc.assert(
      fc.property(maximal, (value) => {
        expect(byteLength(encodeAttestation(value))).toBeLessThanOrEqual(HCS_MESSAGE_MAX_BYTES);
      }),
      { numRuns: 500 },
    );
  });
});
