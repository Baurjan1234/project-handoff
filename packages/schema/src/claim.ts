/**
 * The claim.
 *
 * An HCS message an expert submits from their own account, on the orders
 * topic, to say "I am taking this order". It is the smallest message in the
 * protocol on purpose, because the topic message already carries the two
 * facts that matter:
 *
 * - **Who claimed** is the message's payer account. Putting a claimant field
 *   in the body would be a second source of truth that could disagree with
 *   the account that actually signed. Same rule as the attestation.
 * - **When** is the consensus timestamp. No claimed-at field in the body, for
 *   the same reason the order envelope has no posted-at field: the network's
 *   clock decides, and nothing the claimant writes can move it.
 *
 * The claim carries `cert_tag` so a reader can drop a claim made under the
 * wrong credential without fetching anything else, and so the registry check
 * (when it exists) has something to check at claim time rather than at sign
 * time.
 *
 * Claims share the orders topic. The order envelope is a strict object with no
 * `kind` field, so the two shapes cannot be confused by a parser, and status
 * reads one stream for posted and claimed.
 *
 * The winner rule lives here as code, in `resolveClaims`, because it has two
 * ends: the expert app publishes claims and the requester's status tool reads
 * them. A rule that lived in prose would be implemented twice.
 */

import * as z from "zod";
import { byteLength, canonicalize } from "./canonical.js";
import { HCS_MESSAGE_MAX_BYTES, SCHEMA_VERSION } from "./constants.js";
import type { OrderEnvelope } from "./envelope.js";
import { CertTag, OrderId, utcToEpochSeconds } from "./primitives.js";

export class ClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaimError";
  }
}

export const ClaimEnvelope = z.strictObject({
  kind: z.literal("claim"),
  order_id: OrderId,
  cert_tag: CertTag,
  schema_version: z.literal(SCHEMA_VERSION),
});

export type ClaimEnvelope = z.infer<typeof ClaimEnvelope>;

/** Validate, canonicalize, and prove it fits in one HCS message. */
export function encodeClaim(value: unknown): string {
  const parsed = ClaimEnvelope.parse(value);
  const body = canonicalize(parsed);
  const size = byteLength(body);

  if (size > HCS_MESSAGE_MAX_BYTES) {
    throw new ClaimError(`claim is ${size} bytes, over the ${HCS_MESSAGE_MAX_BYTES}-byte HCS message limit`);
  }

  return body;
}

/** Parse a claim read back from a mirror node. */
export function decodeClaim(body: string): ClaimEnvelope {
  return ClaimEnvelope.parse(JSON.parse(body));
}

/**
 * Is this topic message a claim at all? Orders and claims share a topic, so a
 * reader asks this before deciding which decoder to use. Malformed JSON is
 * "not a claim", not an error: a stray message on a public topic must never
 * break a reader.
 */
export function tryDecodeClaim(body: string): ClaimEnvelope | null {
  try {
    const result = ClaimEnvelope.safeParse(JSON.parse(body));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * A consensus timestamp is `seconds.nanoseconds`. Comparing the strings
 * lexically is wrong once the seconds part changes length, so parse it.
 */
const CONSENSUS_TIMESTAMP = /^(\d+)\.(\d{1,9})$/;

export function parseConsensusTimestamp(value: string): { seconds: bigint; nanos: number } {
  const match = CONSENSUS_TIMESTAMP.exec(value);
  if (match === null) {
    throw new ClaimError(`consensus timestamp "${value}" is not seconds.nanoseconds`);
  }
  return { seconds: BigInt(match[1] ?? "0"), nanos: Number((match[2] ?? "0").padEnd(9, "0")) };
}

export function compareConsensusTimestamps(a: string, b: string): number {
  const left = parseConsensusTimestamp(a);
  const right = parseConsensusTimestamp(b);
  if (left.seconds !== right.seconds) return left.seconds < right.seconds ? -1 : 1;
  return left.nanos - right.nanos;
}

/** A claim as read off the topic: the decoded body plus what the network attached to it. */
export interface ClaimRecord {
  readonly claim: ClaimEnvelope;
  /** The claimant. It is the account that paid to submit, never a field in the body. */
  readonly payerAccountId: string;
  readonly consensusTimestamp: string;
  readonly sequenceNumber: number;
}

export interface ActiveClaim {
  readonly claimantAccountId: string;
  readonly claimedAt: string;
  /** Epoch seconds. Claim timeout, capped at the order deadline: the window never passes the deadline. */
  readonly signByEpochSeconds: number;
  /** True when this claim won the one permitted reopen after an earlier claim expired. */
  readonly reopened: boolean;
  readonly sequenceNumber: number;
}

export type ClaimResolution =
  | { readonly state: "unclaimed" }
  | { readonly state: "claimed"; readonly active: ActiveClaim }
  | { readonly state: "claim_timeout"; readonly expired: ActiveClaim; readonly reopenAvailable: boolean };

export interface ResolveClaimsInput {
  readonly order: OrderEnvelope;
  readonly claims: readonly ClaimRecord[];
  /** Epoch seconds, from the reader's clock or the latest consensus timestamp it has seen. */
  readonly nowEpochSeconds: number;
  /**
   * Consensus timestamp of the winning claimant's attestation, if one exists.
   * A delivered claim is final: its window no longer expires, and no later
   * claim can win. Readers that have not looked at the attestations topic pass
   * nothing and get the pre-delivery answer.
   */
  readonly deliveredAt?: string;
}

function epochSeconds(consensusTimestamp: string): number {
  return Number(parseConsensusTimestamp(consensusTimestamp).seconds);
}

function toActive(order: OrderEnvelope, record: ClaimRecord, reopened: boolean): ActiveClaim {
  const claimedAt = epochSeconds(record.consensusTimestamp);
  return {
    claimantAccountId: record.payerAccountId,
    claimedAt: record.consensusTimestamp,
    signByEpochSeconds: Math.min(claimedAt + order.claim_timeout_seconds, utcToEpochSeconds(order.deadline)),
    reopened,
    sequenceNumber: record.sequenceNumber,
  };
}

/**
 * Who holds the order, given every claim message a reader has seen for it.
 *
 * The rule, which both ends implement by calling this:
 *
 * 1. A claim counts only if its `order_id` and `cert_tag` match the order and
 *    it landed before the order deadline. Anything else is ignored by readers,
 *    never rejected by the network.
 * 2. The first counting claim by consensus timestamp wins. Later claims are
 *    ignored while it is active.
 * 3. If the winner's window expires with no attestation, the first claim that
 *    landed after expiry wins the reopen. Reopen happens once: after the
 *    reopened claim expires, the order is done.
 * 4. A delivered claim never expires. Pass `deliveredAt` once the attestation
 *    is on the topic.
 *
 * Whether the claimant is on the allowlist is not checked here. That is the
 * registry's job once it exists; until then any account can claim, the same
 * admitted limit as the attestation.
 */
export function resolveClaims(input: ResolveClaimsInput): ClaimResolution {
  const { order, nowEpochSeconds, deliveredAt } = input;
  const deadline = utcToEpochSeconds(order.deadline);

  const counting = input.claims
    .filter(
      (record) =>
        record.claim.order_id === order.order_id &&
        record.claim.cert_tag === order.cert_tag &&
        epochSeconds(record.consensusTimestamp) < deadline,
    )
    .sort((a, b) => compareConsensusTimestamps(a.consensusTimestamp, b.consensusTimestamp));

  const first = counting[0];
  if (first === undefined) {
    return { state: "unclaimed" };
  }

  const firstActive = toActive(order, first, false);
  if (deliveredAt !== undefined || nowEpochSeconds < firstActive.signByEpochSeconds) {
    return { state: "claimed", active: firstActive };
  }

  // The first claim expired. Only a claim that landed after expiry can reopen;
  // claims that raced the first one and lost stay lost.
  const reopener = counting.find(
    (record) => epochSeconds(record.consensusTimestamp) >= firstActive.signByEpochSeconds,
  );
  if (reopener === undefined) {
    return { state: "claim_timeout", expired: firstActive, reopenAvailable: true };
  }

  const reopened = toActive(order, reopener, true);
  if (nowEpochSeconds < reopened.signByEpochSeconds) {
    return { state: "claimed", active: reopened };
  }
  return { state: "claim_timeout", expired: reopened, reopenAvailable: false };
}
