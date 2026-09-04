/**
 * Field primitives shared by the order envelope and the attestation.
 *
 * They live here rather than in either one, because an envelope that had to
 * import from the attestation would imply the order depends on its own
 * deliverable, which is backwards.
 */

import * as z from "zod";
import { byteLength } from "./canonical.js";
import { CERT_TAG_MAX_BYTES, DEFECT_CODE_MAX_BYTES, ORDER_ID_MAX_BYTES } from "./constants.js";
import { assertPositive, parseTinybars } from "./money.js";

/** Lowercase hex, because a hash that differs only in case is two hashes. */
export const Sha256Hex = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "expected 64 lowercase hexadecimal characters");

/** Bounded by bytes, not characters, because HCS limits bytes. */
export const boundedBytes = (maxBytes: number, label: string) =>
  z
    .string()
    .min(1, `${label} must not be empty`)
    .refine((value) => byteLength(value) <= maxBytes, {
      message: `${label} must be at most ${maxBytes} bytes`,
    });

export const OrderId = boundedBytes(ORDER_ID_MAX_BYTES, "order_id");
export const CertTag = boundedBytes(CERT_TAG_MAX_BYTES, "cert_tag");
export const DefectCode = boundedBytes(DEFECT_CODE_MAX_BYTES, "defect code");

/**
 * The class is declared at order time and never changes. It describes what the
 * expert returns, not what the requester sent.
 */
export const OrderClass = z.enum(["review", "execution"]);
export type OrderClass = z.infer<typeof OrderClass>;

/**
 * A UTC instant, second precision, `Z` only.
 *
 * Deliberately not "any ISO-8601 string". Offsets and fractional seconds give
 * two encodings of the same moment, which would give two hashes of the same
 * envelope.
 */
export const Utc = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    "expected a UTC instant like 2026-09-14T00:00:00Z, second precision, Z only",
  )
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: "not a real instant" });

export function utcToEpochSeconds(value: string): number {
  return Math.floor(Date.parse(Utc.parse(value)) / 1000);
}

/**
 * An amount on the wire: a tinybar integer as a string.
 *
 * Validated through the money module rather than a regex here, so there is one
 * definition of what an amount is. Stays a string after parsing, because
 * canonical hashing needs the exact bytes that were published.
 */
export const TinybarAmount = z.string().superRefine((value, ctx) => {
  try {
    parseTinybars(value);
  } catch (error) {
    ctx.addIssue({ code: "custom", message: (error as Error).message });
  }
});

/** A price. Zero is not a price. */
export const PositiveTinybarAmount = z.string().superRefine((value, ctx) => {
  try {
    assertPositive(parseTinybars(value));
  } catch (error) {
    ctx.addIssue({ code: "custom", message: (error as Error).message });
  }
});
