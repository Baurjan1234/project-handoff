import { AccountId, type Client, type PrivateKey, TopicId } from "@hiero-ledger/sdk";
import type {
  ChainAdapter,
  ConsensusRef,
  CreateScheduleParams,
  EscrowRef,
  LockFundsParams,
  ReadMessagesOptions,
  ScheduleRef,
  SignScheduleResult,
  TopicMessage,
  TransactionRecord,
  TxRef,
} from "@handoff/schema";
import { executeDirectPayout } from "./direct-payout.js";
import { fundEscrow } from "./escrow.js";
import { submitTopicMessage } from "./hcs.js";
import { fetchMirrorTopicMessages, fetchMirrorTransaction, toMirrorTransactionId } from "./mirror.js";
import { PendingPayoutStore } from "./pending-payout.js";

/**
 * The real ChainAdapter, satisfying @handoff/schema's interface (the cutover seam
 * MockChainAdapter also satisfies). See packages/chain/CLAUDE.md.
 *
 * **createSchedule/signSchedule/deleteSchedule do not touch Hedera's Schedule
 * Service.** docs/research/schedule-create-keylist-blocker.md found
 * ScheduleCreateTransaction cannot debit a KeyList-controlled account (8 isolated
 * testnet tests, root cause unresolved). This adapter instead tracks the pending
 * payout locally (pending-payout.ts) and fires a directly co-signed
 * TransferTransaction the moment signSchedule is called (direct-payout.ts) — the
 * external ChainAdapter contract is unchanged, only the internals. See
 * docs/decisions/2026-09-08-direct-cosigned-payout-replaces-schedulecreate.md.
 *
 * **One shared escrow account — settled, no longer an open question.** Provisioned
 * once out of band (escrow.ts's createEscrowAccount, run separately, not by this
 * class); every order locks funds into it, so `lockFunds` is a plain transfer in and
 * always returns the same `escrowAccountId`. Per-order escrow (with the requester's
 * own public key genuinely in the KeyList) is roadmap, not this week — see
 * ../../../docs/decisions/2026-09-07-one-shared-escrow-account-this-week.md. The
 * third KeyList key is the demo requester's session key; say that out loud if a judge
 * asks who holds it.
 *
 * `lockFunds`'s transfer is signed by whatever the constructor's `client` is
 * authorized as. If that's meant to be the requester's own signature, the caller
 * must construct this adapter with a client whose operator matches
 * `requesterAccountId` — this class does not itself hold or request the requester's key.
 */
export interface HederaChainAdapterConfig {
  client: Client;
  mirrorNodeUrl: string;
  escrowAccountId: AccountId;
  verifierKey: PrivateKey;
  scheduleAdminKey: PrivateKey;
}

export class HederaChainAdapter implements ChainAdapter {
  readonly network = "testnet" as const;
  readonly #pendingPayouts = new PendingPayoutStore();

  constructor(private readonly config: HederaChainAdapterConfig) {}

  async submitMessage(topicId: string, contents: string): Promise<ConsensusRef> {
    const result = await submitTopicMessage(this.config.client, TopicId.fromString(topicId), contents);
    return {
      transactionId: result.transactionId,
      consensusTimestamp: result.result.consensusTimestamp,
      sequenceNumber: Number(result.result.topicSequenceNumber),
    };
  }

  async readMessages(topicId: string, options: ReadMessagesOptions = {}): Promise<readonly TopicMessage[]> {
    const messages = await fetchMirrorTopicMessages(this.config.mirrorNodeUrl, topicId, {
      order: "asc",
      ...(options.afterSequenceNumber !== undefined ? { afterSequenceNumber: options.afterSequenceNumber } : {}),
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
    });

    return messages.map((m) => ({
      topicId,
      sequenceNumber: m.sequence_number,
      consensusTimestamp: m.consensus_timestamp,
      payerAccountId: m.payer_account_id,
      contents: m.message,
    }));
  }

  async lockFunds(params: LockFundsParams): Promise<EscrowRef> {
    const result = await fundEscrow(
      this.config.client,
      AccountId.fromString(params.requesterAccountId),
      this.config.escrowAccountId,
      params.amountTinybars,
    );

    return { transactionId: result.transactionId, escrowAccountId: this.config.escrowAccountId.toString() };
  }

  /** Tracks the payout locally — no Hedera schedule is created. See module doc above. */
  async createSchedule(params: CreateScheduleParams): Promise<ScheduleRef> {
    // No real transaction happens here, so there's no transaction ID of our own to
    // report — the caller gets one the moment money actually moves, at signSchedule.
    // A synthetic ID keeps TxRef honest about what this step actually did (nothing
    // on-chain yet) while still returning something.
    const placeholderTransactionId = `pending@${Date.now()}`;

    const { id, alreadyExisted } = this.#pendingPayouts.create(
      {
        orderId: params.orderId,
        escrowAccountId: params.escrowAccountId,
        payeeAccountId: params.payeeAccountId,
        amountTinybars: params.amountTinybars,
        expiresAt: params.expiresAt,
      },
      placeholderTransactionId,
    );

    return { transactionId: placeholderTransactionId, scheduleId: id, alreadyExisted };
  }

  /**
   * The interface takes only a scheduleId — it deliberately hides that early-execute
   * needs two signatures. Both platform keys co-sign the SAME TransferTransaction in
   * one call (direct-payout.ts), not two separate ScheduleSign calls over time.
   * Idempotent: signing an already-executed payout returns success without
   * re-submitting anything.
   */
  async signSchedule(scheduleId: string): Promise<SignScheduleResult> {
    const record = this.#pendingPayouts.get(scheduleId);

    if (record.deleted) {
      throw new Error(`payout ${scheduleId} was cancelled and cannot be signed`);
    }

    if (record.executed) {
      return { transactionId: record.executedTransactionId ?? record.createdTransactionId, executed: true };
    }

    const result = await executeDirectPayout(this.config.client, {
      escrowAccountId: AccountId.fromString(record.escrowAccountId),
      payeeAccountId: AccountId.fromString(record.payeeAccountId),
      amountTinybars: record.amountTinybars,
      verifierKey: this.config.verifierKey,
      scheduleAdminKey: this.config.scheduleAdminKey,
    });

    this.#pendingPayouts.markExecuted(scheduleId, result.transactionId);
    return { transactionId: result.transactionId, executed: true };
  }

  /**
   * Cancels the local record only — there is no Hedera schedule to delete. No new
   * on-chain fact is created by cancelling; the transaction ID returned is the one
   * that established the payout being cancelled, not a new one. Not on today's
   * demo path (that's the happy path: POSTED -> CLAIMED -> DELIVERED -> SETTLED);
   * revisit if CLAIM_TIMEOUT/VIOLATION need their own on-chain audit trail later.
   */
  async deleteSchedule(scheduleId: string): Promise<TxRef> {
    const record = this.#pendingPayouts.get(scheduleId);
    this.#pendingPayouts.markDeleted(scheduleId);
    return { transactionId: record.createdTransactionId };
  }

  async getTransaction(transactionId: string): Promise<TransactionRecord | null> {
    const tx = await fetchMirrorTransaction(this.config.mirrorNodeUrl, transactionId);
    if (!tx) return null;

    return {
      transactionId: tx.transaction_id,
      status: tx.result === "SUCCESS" ? "SUCCESS" : "FAILED",
      consensusTimestamp: tx.consensus_timestamp,
    };
  }
}

export { toMirrorTransactionId };
