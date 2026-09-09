/**
 * Pending-payout bookkeeping — the replacement for Hedera's native Schedule Service,
 * which docs/research/schedule-create-keylist-blocker.md found cannot debit a
 * KeyList-controlled account (8 isolated testnet tests, root cause unresolved as of
 * 2026-09-08). See docs/decisions/2026-09-08-direct-cosigned-payout-replaces-schedulecreate.md
 * for the decision this implements.
 *
 * The core realization: the verifier and schedule-admin keys already live in the
 * same trusted backend process (Known limits — "the platform is trusted this week").
 * Hedera's Schedule Service exists to accumulate signatures from parties who sign at
 * DIFFERENT times, from different processes. We don't have that problem — both keys
 * are available in the same call. So instead of creating a network-tracked Schedule
 * and asking the network to accumulate two ScheduleSign calls, this module tracks
 * the pending payout's parameters locally and fires a single, directly co-signed
 * TransferTransaction the moment `signSchedule` is called — same external contract,
 * no dependency on the primitive that doesn't work for this key shape.
 *
 * Honest limitation, stated once here rather than re-discovered later: this state is
 * in-memory, per-process. A restart loses pending (not-yet-executed) payouts. For
 * today's live demo this is acceptable — the whole flow runs inside one demo
 * session — but a real deployment needs this backed by something durable (the
 * content store, or a small database) before it's more than a demo.
 */

import { canonicalize, sha256Hex } from "@handoff/schema";

export interface PendingPayoutParams {
  orderId: string;
  escrowAccountId: string;
  payeeAccountId: string;
  amountTinybars: string;
  expiresAt: string;
}

interface PendingPayoutRecord extends PendingPayoutParams {
  id: string;
  executed: boolean;
  executedTransactionId: string | null;
  deleted: boolean;
  createdTransactionId: string;
}

export class PendingPayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PendingPayoutError";
  }
}

/** Deterministic — identical params produce the identical id, mirroring IDENTICAL_SCHEDULE_ALREADY_CREATED's idempotency without a real network call. */
export function derivePendingPayoutId(params: PendingPayoutParams): string {
  return `pending-${sha256Hex(canonicalize(params))}`;
}

export class PendingPayoutStore {
  readonly #records = new Map<string, PendingPayoutRecord>();

  /** Returns { id, alreadyExisted } — alreadyExisted mirrors the real primitive's semantics. */
  create(params: PendingPayoutParams, createdTransactionId: string): { id: string; alreadyExisted: boolean } {
    const id = derivePendingPayoutId(params);
    if (this.#records.has(id)) {
      return { id, alreadyExisted: true };
    }

    this.#records.set(id, {
      ...params,
      id,
      executed: false,
      executedTransactionId: null,
      deleted: false,
      createdTransactionId,
    });
    return { id, alreadyExisted: false };
  }

  get(id: string): PendingPayoutRecord {
    const record = this.#records.get(id);
    if (!record) {
      throw new PendingPayoutError(`no pending payout tracked under ${id}`);
    }
    return record;
  }

  markExecuted(id: string, transactionId: string): void {
    const record = this.get(id);
    record.executed = true;
    record.executedTransactionId = transactionId;
  }

  markDeleted(id: string): void {
    const record = this.get(id);
    if (record.executed) {
      throw new PendingPayoutError(`payout ${id} already executed; a paid order cannot be clawed back`);
    }
    record.deleted = true;
  }
}
