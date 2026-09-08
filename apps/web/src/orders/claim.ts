/**
 * Claim is confirmed, not assumed.
 *
 * A claim is a message on the orders topic from the expert's own account.
 * The button acknowledges the click at once; the *result* waits for the
 * mirror, because the consensus timestamp decides who won and the submit
 * receipt only says that our message was accepted, not that it was first.
 * So the sequence is: submit, then read the topic until the mirror shows our
 * message, then look at every claim for this order in consensus order. The
 * earliest one wins. If it is ours, the workspace opens. If it is not, the
 * screen says "Someone else claimed this" and that is an ordinary outcome.
 *
 * Same shape as settlement: a read that throws is "not yet", the loop keeps
 * going, and after `giveUpAfterMs` it stops in a state the screen can retry
 * from. Nothing spins forever.
 *
 * The claim message's schema is not in the treaty yet. This shape is the
 * app's, is versioned, and is the one asked of P1 for the cutover: whatever
 * `packages/chain` publishes at claim time must let a reader recover
 * `order_id` and the claimant, in consensus order.
 */

import { OrderId, SCHEMA_VERSION, type ConsensusRef, type ReadMessagesOptions, type TopicMessage } from "@handoff/schema";
import { signBy } from "../lib/clock";
import { abortableSleep } from "../sign/settlement";
import type { ClaimState } from "./order";

export interface ClaimMessage {
  readonly kind: "claim";
  readonly order_id: string;
  readonly claimant: string;
  readonly schema_version: typeof SCHEMA_VERSION;
}

export function encodeClaim(orderId: string, claimant: string): string {
  const message: ClaimMessage = {
    kind: "claim",
    order_id: OrderId.parse(orderId),
    claimant,
    schema_version: SCHEMA_VERSION,
  };
  if (claimant.length === 0) throw new Error("a claim needs a claimant");
  return JSON.stringify(message);
}

/** Exactly the four fields, or nothing. An extra or missing one is not a claim. */
export function decodeClaim(value: unknown): ClaimMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(",") !== "claimant,kind,order_id,schema_version") return null;
  const { kind, order_id, claimant, schema_version } = record;
  if (kind !== "claim" || schema_version !== SCHEMA_VERSION) return null;
  if (typeof order_id !== "string" || !OrderId.safeParse(order_id).success) return null;
  if (typeof claimant !== "string" || claimant.length === 0) return null;
  return { kind, order_id, claimant, schema_version };
}

/** A claim as read back, with the network's word on when. */
export interface ClaimRecord {
  readonly claimant: string;
  readonly consensusTimestamp: string;
  readonly sequenceNumber: number;
}

/** Ordered by consensus timestamp, which is the truth about who was first. */
export function claimsFor(messages: readonly TopicMessage[], orderId: string): readonly ClaimRecord[] {
  const claims: ClaimRecord[] = [];
  for (const message of messages) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(message.contents);
    } catch {
      continue;
    }
    const claim = decodeClaim(parsed);
    if (claim === null || claim.order_id !== orderId) continue;
    claims.push({
      claimant: claim.claimant,
      consensusTimestamp: message.consensusTimestamp,
      sequenceNumber: message.sequenceNumber,
    });
  }
  return claims.sort((a, b) => compareTimestamps(a.consensusTimestamp, b.consensusTimestamp));
}

/** `seconds.nanoseconds` compared as numbers, never as strings. */
export function compareTimestamps(a: string, b: string): number {
  const [as, an] = a.split(".");
  const [bs, bn] = b.split(".");
  const seconds = Number(as) - Number(bs);
  if (seconds !== 0) return seconds;
  return Number((an ?? "0").padEnd(9, "0")) - Number((bn ?? "0").padEnd(9, "0"));
}

export function epochSecondsOf(consensusTimestamp: string): number {
  return Number(consensusTimestamp.split(".")[0]);
}

/** What the mirror says for one order, from its claims in consensus order. */
export function claimStateFor(
  claims: readonly ClaimRecord[],
  expertAccountId: string,
  claimTimeoutSeconds: number,
  deadline: string,
): ClaimState {
  const first = claims[0];
  if (first === undefined) return { kind: "open" };
  if (first.claimant !== expertAccountId) return { kind: "someone-else" };
  const claimedAtEpochSeconds = epochSecondsOf(first.consensusTimestamp);
  return {
    kind: "yours",
    claimedAtEpochSeconds,
    signBy: signBy(claimedAtEpochSeconds, claimTimeoutSeconds, deadline),
  };
}

/** `ChainAdapter` satisfies this structurally. Narrowed so a test can fake one read. */
export interface ClaimReader {
  readMessages(topicId: string, options?: ReadMessagesOptions): Promise<readonly TopicMessage[]>;
}

export type ClaimPhase =
  /** Submitted and accepted; the mirror has not shown it yet. */
  | "confirming"
  /** The mirror shows our claim as the earliest. Claimed · yours to review. */
  | "yours"
  /** The mirror shows an earlier claim. Someone else claimed this. */
  | "someone-else"
  /** Polling stopped without an answer. A retry is offered. */
  | "stalled";

export interface ClaimConfirmation {
  readonly phase: ClaimPhase;
  readonly elapsedMs: number;
  readonly claimTransactionId: string;
  /** Set with phase `yours`. */
  readonly state: ClaimState | null;
  readonly lastReadError: string | null;
}

export interface ConfirmClaimParams {
  readonly topicId: string;
  readonly orderId: string;
  readonly expertAccountId: string;
  readonly claimTimeoutSeconds: number;
  readonly deadline: string;
  /** What the submit returned. Its sequence number is how we spot our own message. */
  readonly submitted: ConsensusRef;
  readonly reader: ClaimReader;
  readonly onChange?: (state: ClaimConfirmation) => void;
  readonly signal?: AbortSignal;
}

export interface ConfirmOptions {
  readonly intervalMs: number;
  readonly giveUpAfterMs: number;
  readonly now: () => number;
  readonly sleep: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
}

export const DEFAULT_CONFIRM_OPTIONS: ConfirmOptions = {
  intervalMs: 1_500,
  giveUpAfterMs: 60_000,
  now: Date.now,
  sleep: abortableSleep,
};

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
      messages = await params.reader.readMessages(params.topicId);
    } catch (error) {
      readError = error instanceof Error ? error.message : String(error);
    }

    const elapsedMs = options.now() - started;

    if (messages !== null) {
      const claims = claimsFor(messages, params.orderId);
      const ours = claims.some((c) => c.sequenceNumber === params.submitted.sequenceNumber);
      const earlier = claims.some(
        (c) => compareTimestamps(c.consensusTimestamp, params.submitted.consensusTimestamp) < 0,
      );
      // Decide once the mirror shows our message, or an earlier claim. An
      // earlier claim already decides it: nothing that arrives later can
      // move in front of it.
      if (ours || earlier) {
        const resolved = claimStateFor(claims, params.expertAccountId, params.claimTimeoutSeconds, params.deadline);
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
