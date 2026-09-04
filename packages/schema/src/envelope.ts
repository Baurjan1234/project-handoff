/**
 * The order envelope.
 *
 * Published to an HCS topic at POSTED. Hashes only: the task specification, the
 * artifact and the acceptance criteria all live in the content store, and only
 * their commitments are published.
 *
 * Class-specific rules, mirroring the attestation:
 *
 * - `review` requires `artifact_hash_in`. A review with nothing to review is
 *   not an order.
 * - `execution` makes the input optional, because an execution order can start
 *   from nothing, from something half-finished, or from a complete artifact.
 *   It requires `acceptance_hash`, because acceptance evidence for an execution
 *   is defined per order and an execution order without it cannot be settled.
 */

import * as z from "zod";
import { byteLength, canonicalize } from "./canonical.js";
import {
  CLAIM_TIMEOUT_MAX_SECONDS,
  CLAIM_TIMEOUT_MAX_SHARE_OF_WINDOW,
  CLAIM_TIMEOUT_MIN_SECONDS,
  HCS_MESSAGE_MAX_BYTES,
  SCHEMA_VERSION,
} from "./constants.js";
import { CertTag, OrderId, PositiveTinybarAmount, Sha256Hex, Utc, utcToEpochSeconds } from "./primitives.js";

export class EnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvelopeError";
  }
}

const shared = {
  order_id: OrderId,
  /** The task specification lives in the content store. Hashes only on-chain. */
  spec_hash: Sha256Hex,
  cert_tag: CertTag,
  price_tinybars: PositiveTinybarAmount,
  deadline: Utc,
  claim_timeout_seconds: z
    .int()
    .min(CLAIM_TIMEOUT_MIN_SECONDS)
    .max(CLAIM_TIMEOUT_MAX_SECONDS),
  schema_version: z.literal(SCHEMA_VERSION),
};

export const ReviewOrder = z.strictObject({
  ...shared,
  class: z.literal("review"),
  artifact_hash_in: Sha256Hex,
});

export const ExecutionOrder = z.strictObject({
  ...shared,
  class: z.literal("execution"),
  artifact_hash_in: Sha256Hex.optional(),
  acceptance_hash: Sha256Hex,
});

export const OrderEnvelope = z.discriminatedUnion("class", [ReviewOrder, ExecutionOrder]);

export type ReviewOrder = z.infer<typeof ReviewOrder>;
export type ExecutionOrder = z.infer<typeof ExecutionOrder>;
export type OrderEnvelope = z.infer<typeof OrderEnvelope>;

/**
 * The relative claim-timeout rule, which the envelope cannot check alone.
 *
 * A posted-at field in the envelope would be a second source of truth competing
 * with the consensus timestamp, so it is not there. Call this at post time with
 * the timestamp the network assigned.
 */
export function assertClaimTimeoutFitsWindow(
  postedAtEpochSeconds: number,
  envelope: OrderEnvelope,
): void {
  const window = utcToEpochSeconds(envelope.deadline) - postedAtEpochSeconds;

  if (window <= 0) {
    throw new EnvelopeError(
      `deadline ${envelope.deadline} is not in the future relative to the consensus timestamp`,
    );
  }

  const allowed = Math.floor(window * CLAIM_TIMEOUT_MAX_SHARE_OF_WINDOW);
  if (envelope.claim_timeout_seconds > allowed) {
    throw new EnvelopeError(
      `claim_timeout_seconds is ${envelope.claim_timeout_seconds}, over the ${allowed} allowed for a ` +
        `${window}-second window. A claim timeout close to the deadline lets a lazy claimant hold ` +
        `funds hostage, which is the whole reason the two are separate events.`,
    );
  }
}

function pruneUndefined<T extends object>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

/** Validate, canonicalize, and prove it fits in one HCS message. */
export function encodeEnvelope(value: unknown): string {
  const parsed = OrderEnvelope.parse(value);
  const body = canonicalize(pruneUndefined(parsed));
  const size = byteLength(body);

  if (size > HCS_MESSAGE_MAX_BYTES) {
    throw new EnvelopeError(
      `order envelope is ${size} bytes, over the ${HCS_MESSAGE_MAX_BYTES}-byte HCS message limit`,
    );
  }

  return body;
}

/** Parse an envelope read back from a mirror node. */
export function decodeEnvelope(body: string): OrderEnvelope {
  return OrderEnvelope.parse(JSON.parse(body));
}
