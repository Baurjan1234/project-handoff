/**
 * The attestation.
 *
 * An HCS message submitted from the expert's own Hedera account, where the
 * account signature is the attestation signature. The expert's key signs this
 * message and nothing else; it is never a schedule key.
 *
 * The class rule is the reason this is a discriminated union of strict objects
 * rather than one object with four optional hashes. `review` carries
 * `artifact_hash_in` and never `artifact_hash_out`. `execution` carries
 * `artifact_hash_out`, plus `_in` when an input existed. A missing or extra
 * hash is a schema violation, and a schema violation is the only path that
 * claws money back, so the wrong shape must be impossible to construct and
 * impossible to parse.
 */

import * as z from "zod";
import { byteLength, canonicalize } from "./canonical.js";
import { DEFECTS_MAX_ITEMS, HCS_MESSAGE_MAX_BYTES, SCHEMA_VERSION } from "./constants.js";
import { CertTag, DefectCode, OrderId, Sha256Hex } from "./primitives.js";

export class HcsSizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HcsSizeError";
  }
}

/**
 * A reject is a delivered product and gets paid, same as an approve. Payment
 * releases on the signature, not on the verdict.
 */
export const Verdict = z.enum(["approve", "approve_with_changes", "reject"]);

const shared = {
  order_id: OrderId,
  verdict: Verdict,
  defects: z.array(DefectCode).max(DEFECTS_MAX_ITEMS),
  notes_hash: Sha256Hex,
  cert_tag: CertTag,
  schema_version: z.literal(SCHEMA_VERSION),
  prior_attestation_ref: Sha256Hex.optional(),
};

/** A signed verdict on an artifact. No output hash exists, because nothing was produced. */
export const ReviewAttestation = z.strictObject({
  ...shared,
  class: z.literal("review"),
  artifact_hash_in: Sha256Hex,
});

/** The outcome itself. An input hash only when an input existed. */
export const ExecutionAttestation = z.strictObject({
  ...shared,
  class: z.literal("execution"),
  artifact_hash_in: Sha256Hex.optional(),
  artifact_hash_out: Sha256Hex,
});

export const Attestation = z.discriminatedUnion("class", [
  ReviewAttestation,
  ExecutionAttestation,
]);

export type ReviewAttestation = z.infer<typeof ReviewAttestation>;
export type ExecutionAttestation = z.infer<typeof ExecutionAttestation>;
export type Attestation = z.infer<typeof Attestation>;
export type Verdict = z.infer<typeof Verdict>;

/**
 * Drop keys whose value is undefined.
 *
 * A JSON round trip never produces them, but `{ ...base, artifact_hash_in: maybe }`
 * does, and canonicalization rejects undefined on purpose. Pruning here keeps
 * that one ergonomic case from looking like a schema failure.
 */
function pruneUndefined<T extends object>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

/**
 * Validate, canonicalize, and prove it fits in one HCS message.
 *
 * Chunking exists, but a chunked attestation is a worse artifact than a bounded
 * one, so this refuses rather than splits.
 */
export function encodeAttestation(value: unknown): string {
  const parsed = Attestation.parse(value);
  const body = canonicalize(pruneUndefined(parsed));
  const size = byteLength(body);

  if (size > HCS_MESSAGE_MAX_BYTES) {
    throw new HcsSizeError(
      `attestation is ${size} bytes, over the ${HCS_MESSAGE_MAX_BYTES}-byte HCS message limit. ` +
        `Shorten defects[]; the written review belongs in the content store behind notes_hash.`,
    );
  }

  return body;
}

/** Parse a message read back from a mirror node. */
export function decodeAttestation(body: string): Attestation {
  return Attestation.parse(JSON.parse(body));
}
