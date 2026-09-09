/**
 * Claim is confirmed, not assumed.
 *
 * A claim is the treaty's `ClaimEnvelope` on the orders topic, submitted from
 * the expert's own account: the payer account is the claimant and the
 * consensus timestamp is the claim time, neither in the body. The button
 * acknowledges the click at once; the *result* waits for the mirror, because
 * the submit receipt only says that our message was accepted, not that it was
 * first. So the sequence is: submit, then read the topic until the mirror
 * shows our message, then ask the treaty's `resolveClaims` who holds the
 * order. If it is us, the workspace opens. If it is not, the screen says
 * "Someone else claimed this" and that is an ordinary outcome.
 *
 * The winner rule is not here. It is `resolveClaims` in `@handoff/schema`,
 * because it has two ends, this app and the requester's status tool, and a
 * rule implemented twice is a rule that disagrees with itself.
 *
 * Same shape as settlement: a read that throws is "not yet", the loop keeps
 * going, and after `giveUpAfterMs` it stops in a state the screen can retry
 * from. Nothing spins forever.
 */

import {
  compareConsensusTimestamps,
  encodeClaim,
  parseConsensusTimestamp,
  resolveClaims,
  SCHEMA_VERSION,
  tryDecodeClaim,
  type ClaimRecord,
  type ConsensusRef,
  type OrderEnvelope,
  type ReadMessagesOptions,
  type TopicMessage,
} from "@handoff/schema";
import { epochSecondsToUtc } from "../lib/clock";
import { abortableSleep } from "../sign/settlement";
import type { ClaimState } from "./order";

/** The bytes a claim for this order puts on the topic. */
export function claimBody(order: OrderEnvelope): string {
  return encodeClaim({ kind: "claim", order_id: order.order_id, cert_tag: order.cert_tag, schema_version: SCHEMA_VERSION });
}

export function epochSecondsOf(consensusTimestamp: string): number {
  return Number(parseConsensusTimestamp(consensusTimestamp).seconds);
}

/** Every claim for the order the mirror has shown, in consensus order. Anything unparsable is not a claim. */
export function claimRecordsFor(messages: readonly TopicMessage[], orderId: string): readonly ClaimRecord[] {
  const records: ClaimRecord[] = [];
  for (const message of messages) {
    const claim = tryDecodeClaim(message.contents);
    if (claim === null || claim.order_id !== orderId) continue;
    records.push({
      claim,
      payerAccountId: message.payerAccountId,
      consensusTimestamp: message.consensusTimestamp,
      sequenceNumber: message.sequenceNumber,
    });
  }
  return records.sort((a, b) => compareConsensusTimestamps(a.consensusTimestamp, b.consensusTimestamp));
}

/** What the treaty's rule says for one order, in the words the screens use. */
export function claimStateFor(
  order: OrderEnvelope,
  records: readonly ClaimRecord[],
  expertAccountId: string,
  nowEpochSeconds: number,
): ClaimState {
  const resolution = resolveClaims({ order, claims: records, nowEpochSeconds });
  switch (resolution.state) {
    case "unclaimed":
      return { kind: "open" };
    case "claimed":
      return resolution.active.claimantAccountId === expertAccountId
        ? {
            kind: "yours",
            claimedAtEpochSeconds: epochSecondsOf(resolution.active.claimedAt),
            signBy: epochSecondsToUtc(resolution.active.signByEpochSeconds),
          }
        : { kind: "someone-else" };
    case "claim_timeout":
      return resolution.reopenAvailable ? { kind: "open" } : { kind: "closed" };
  }
}

/** `ChainAdapter` satisfies this structurally. Narrowed so a test can fake one read. */
export interface ClaimReader {
  readMessages(topicId: string, options?: ReadMessagesOptions): Promise<readonly TopicMessage[]>;
}

export type ClaimPhase =
  /** Submitted and accepted; the mirror has not shown it yet. */
  | "confirming"
  /** The mirror shows our claim as the one that holds the order. Claimed · yours to review. */
  | "yours"
  /** The mirror shows the order is not ours. Someone else claimed this. */
  | "someone-else"
  /** Polling stopped without an answer. A retry is offered. */
  | "stalled";

export interface ClaimConfirmation {
  readonly phase: ClaimPhase;
  readonly elapsedMs: number;
  readonly claimTransactionId: string;
  /** Set once decided. */
  readonly state: ClaimState | null;
  readonly lastReadError: string | null;
}

export interface ConfirmClaimParams {
  readonly topicId: string;
  readonly order: OrderEnvelope;
  readonly expertAccountId: string;
  /** What the submit returned. Its sequence number is how we spot our own message. */
  readonly submitted: ConsensusRef;
  readonly reader: ClaimReader;
  readonly onChange?: (state: ClaimConfirmation) => void;
  readonly signal?: AbortSignal;
}

export interface ConfirmOptions {
  readonly intervalMs: number;
  readonly giveUpAfterMs: number;
  /** Epoch milliseconds. */
  readonly now: () => number;
  readonly sleep: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
}

export const DEFAULT_CONFIRM_OPTIONS: ConfirmOptions = {
  intervalMs: 1_500,
  giveUpAfterMs: 60_000,
  now: Date.now,
  sleep: abortableSleep,
};

/** A mirror read asks for up to this many messages. The public mirror node's ceiling. */
export const TOPIC_READ_LIMIT = 100;

export async function confirmClaim(
  params: ConfirmClaimParams,
  overrides: Partial<ConfirmOptions> = {},
): Promise<ClaimConfirmation> {
  const options = { ...DEFAULT_CONFIRM_OPTIONS, ...overrides };
  const started = options.now();
  let state: ClaimConfirmation = {
    phase: "confirming",
    elapsedMs: 0,
    claimTransactionId: params.submitted.transactionId,
    state: null,
    lastReadError: null,
  };
  const emit = (next: ClaimConfirmation): ClaimConfirmation => {
    state = next;
    params.onChange?.(next);
    return next;
  };
  emit(state);

  for (;;) {
    if (params.signal?.aborted) return state;

    let readError: string | null = null;
    let messages: readonly TopicMessage[] | null = null;
    try {
      messages = await params.reader.readMessages(params.topicId, { limit: TOPIC_READ_LIMIT });
    } catch (error) {
      readError = error instanceof Error ? error.message : String(error);
    }

    const elapsedMs = options.now() - started;

    if (messages !== null) {
      const records = claimRecordsFor(messages, params.order.order_id);
      const ours = records.some((r) => r.sequenceNumber === params.submitted.sequenceNumber);
      const earlier = records.some((r) => compareConsensusTimestamps(r.consensusTimestamp, params.submitted.consensusTimestamp) < 0);
      // Decide once the mirror shows our message, or an earlier claim. An
      // earlier claim already decides it: nothing that arrives later can
      // move in front of it.
      if (ours || earlier) {
        const nowEpochSeconds = Math.max(Math.floor(options.now() / 1000), epochSecondsOf(params.submitted.consensusTimestamp));
        const resolved = claimStateFor(params.order, records, params.expertAccountId, nowEpochSeconds);
        return emit({
          ...state,
          elapsedMs,
          lastReadError: null,
          phase: resolved.kind === "yours" ? "yours" : "someone-else",
          state: resolved,
        });
      }
    }

    if (elapsedMs >= options.giveUpAfterMs) {
      return emit({ ...state, elapsedMs, lastReadError: readError, phase: "stalled" });
    }

    emit({ ...state, elapsedMs, lastReadError: readError });
    await options.sleep(options.intervalMs, params.signal);
  }
}
