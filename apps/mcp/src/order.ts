/**
 * Order packaging and the fund-lock call.
 *
 * This is what `handoff_verify` does once the x402 gate has let a call
 * through: turn a requester's task into an order envelope, put the content
 * where only its hashes leave, lock the money, and publish.
 *
 * Three rules are load-bearing here rather than decorative.
 *
 * **Hashes only.** The specification and the artifact go to the content store.
 * The envelope carries `spec_hash` and `artifact_hash_in` and nothing else
 * about them, and there is a test that greps the published body for the input
 * text to keep it that way.
 *
 * **No schedule at post time.** `ScheduleCreate` carries a fully formed inner
 * transfer, so the payee has to be known, and at `POSTED` nobody has claimed
 * yet. The schedule is created at claim time. See
 * `../../../docs/research/hedera-primitives-verified.md`.
 *
 * **`review` only.** The `execution` class exists in the schema and in the
 * architecture, and building a working execution path is Tier 3 this week. A
 * request for one is refused here rather than half-supported.
 */

import { randomUUID } from "node:crypto";
import {
  assertClaimTimeoutFitsWindow,
  encodeEnvelope,
  formatTinybars,
  hbarToTinybars,
  ReviewOrder,
  SCHEMA_VERSION,
  sha256Hex,
  type ChainAdapter,
} from "@handoff/schema";
import type { ContentStore } from "./content.js";

export class OrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderError";
  }
}

export interface ReviewOrderRequest {
  /** The task specification. Stored, hashed, never published. */
  readonly spec: string;
  /** The artifact to be reviewed. Stored, hashed, never published. */
  readonly artifact: Uint8Array;
  /** Which certification may claim this. */
  readonly certTag: string;
  /** The price of the judgment, in HBAR, as a string. Never a float. */
  readonly priceHbar: string;
  /** Order deadline: UTC, second precision, `Z` only. */
  readonly deadline: string;
  /** Short relative to the deadline, so a lazy claimant cannot hold the funds. */
  readonly claimTimeoutSeconds: number;
}

export interface PackageDeps {
  readonly content: ContentStore;
  /** Injectable so tests are deterministic. */
  readonly now?: () => number;
  readonly newOrderId?: () => string;
}

export interface PostDeps extends PackageDeps {
  readonly chain: ChainAdapter;
  readonly ordersTopicId: string;
  /** Whose funds are being locked. One of the three escrow keys is theirs. */
  readonly requesterAccountId: string;
}

export interface PackagedOrder {
  readonly envelope: ReviewOrder;
  /** Canonical bytes, validated and proven to fit one HCS message. */
  readonly body: string;
  readonly specRef: string;
  readonly artifactRef: string;
}

export interface PostedOrder extends PackagedOrder {
  readonly orderId: string;
  readonly escrowAccountId: string;
  /** The network's word on when this was posted, and the truth for ordering. */
  readonly consensusTimestamp: string;
  readonly sequenceNumber: number;
  /**
   * Every transaction id this produced, threaded rather than swallowed.
   * Settlement state is read from a mirror node, never inferred from these.
   */
  readonly transactionIds: {
    readonly lockFunds: string;
    readonly submitEnvelope: string;
  };
}

const encoder = new TextEncoder();

function defaultOrderId(): string {
  // 36 bytes, inside the 64-byte bound, and readable in a log line.
  return `ord_${randomUUID().replaceAll("-", "")}`;
}

/**
 * `seconds.nanoseconds` to whole seconds.
 *
 * Deliberately string surgery rather than `Number()` on the whole thing: the
 * nanosecond part would round into the seconds and move the instant.
 */
export function consensusEpochSeconds(consensusTimestamp: string): number {
  const seconds = consensusTimestamp.split(".")[0];
  if (seconds === undefined || !/^\d+$/.test(seconds)) {
    throw new OrderError(
      `consensus timestamp ${consensusTimestamp} is not seconds.nanoseconds`,
    );
  }
  return Number.parseInt(seconds, 10);
}

/**
 * Store the content, hash it, and build the envelope.
 *
 * Runs before any money moves, so everything that can be rejected on shape
 * alone is rejected while the only cost is a wasted store write.
 */
export async function packageReviewOrder(
  request: ReviewOrderRequest,
  deps: PackageDeps,
): Promise<PackagedOrder> {
  const now = deps.now ?? Date.now;
  const orderId = (deps.newOrderId ?? defaultOrderId)();

  if (request.artifact.byteLength === 0) {
    throw new OrderError("a review order needs an artifact to review");
  }

  const specBytes = encoder.encode(request.spec);
  const specHash = sha256Hex(specBytes);
  const artifactHash = sha256Hex(request.artifact);

  const [specRef, artifactRef] = await Promise.all([
    deps.content.put(specHash, specBytes),
    deps.content.put(artifactHash, request.artifact),
  ]);

  const envelope = ReviewOrder.parse({
    order_id: orderId,
    class: "review",
    spec_hash: specHash,
    artifact_hash_in: artifactHash,
    cert_tag: request.certTag,
    price_tinybars: formatTinybars(hbarToTinybars(request.priceHbar)),
    deadline: request.deadline,
    claim_timeout_seconds: request.claimTimeoutSeconds,
    schema_version: SCHEMA_VERSION,
  });

  // Preflight against our own clock. The authoritative check is against the
  // consensus timestamp after publishing, but failing here costs nothing and
  // failing there means an unusable envelope is already on a topic.
  assertClaimTimeoutFitsWindow(Math.floor(now() / 1000), envelope);

  return { envelope, body: encodeEnvelope(envelope), specRef, artifactRef };
}

/**
 * Package, lock the funds, publish the envelope.
 *
 * **Lock before publish, and that order matters.** Publishing first and then
 * failing to lock would leave a public order with no money behind it, which a
 * certified expert could claim and work on for nothing. Locking first and then
 * failing to publish leaves funds in an escrow we control, with no order
 * anybody has seen — recoverable, and nobody has been misled.
 */
export async function postReviewOrder(
  request: ReviewOrderRequest,
  deps: PostDeps,
): Promise<PostedOrder> {
  const packaged = await packageReviewOrder(request, deps);
  const { envelope } = packaged;

  const escrow = await deps.chain.lockFunds({
    orderId: envelope.order_id,
    amountTinybars: envelope.price_tinybars,
    requesterAccountId: deps.requesterAccountId,
  });

  const consensus = await deps.chain.submitMessage(deps.ordersTopicId, packaged.body);

  // No createSchedule here. The payee is unknown until somebody claims, and
  // ScheduleCreate needs a fully formed inner transfer.

  const posted: PostedOrder = {
    ...packaged,
    orderId: envelope.order_id,
    escrowAccountId: escrow.escrowAccountId,
    consensusTimestamp: consensus.consensusTimestamp,
    sequenceNumber: consensus.sequenceNumber,
    transactionIds: {
      lockFunds: escrow.transactionId,
      submitEnvelope: consensus.transactionId,
    },
  };

  try {
    assertClaimTimeoutFitsWindow(consensusEpochSeconds(consensus.consensusTimestamp), envelope);
  } catch (error) {
    // The envelope is already published, so this cannot be undone by throwing.
    // Carry the ids out with the failure: whoever handles this needs them to
    // find the order that must not be claimed.
    throw new OrderError(
      `order ${envelope.order_id} was published but its claim timeout does not fit the ` +
        `window the network assigned (${(error as Error).message}). ` +
        `lockFunds ${escrow.transactionId}, submitEnvelope ${consensus.transactionId}`,
    );
  }

  return posted;
}
