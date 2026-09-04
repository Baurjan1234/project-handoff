/**
 * MockChainAdapter.
 *
 * Exists so P2 and P3 can build from hour one against the same interface P1's
 * real adapter will satisfy. After the Monday-night cutover it is a test
 * fixture only and never appears in a demo or a recording.
 *
 * **Transaction ids here are deliberately malformed.** A real Hedera id looks
 * like `0.0.1234@1757000000.000000000`; these look like `MOCK-tx-1`. Mock ids
 * 404 on Hashscan, so the failure mode we are guarding against is one reaching
 * a recording unnoticed. Making them visibly not-Hedera means anyone who sees
 * one on screen knows immediately, rather than a judge discovering it later.
 *
 * Consensus timestamps keep their real shape, because ordering logic parses
 * them and that logic has to be exercised.
 */

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
} from "./adapter.js";

export class MockChainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MockChainError";
  }
}

export interface MockChainAdapterOptions {
  /** Injectable so tests are deterministic. Epoch milliseconds. */
  readonly now?: () => number;
  /** The escrow is 2-of-3, so a payout needs two signatures: verifier and admin. */
  readonly requiredSignatures?: number;
}

interface MockSchedule {
  readonly scheduleId: string;
  readonly key: string;
  readonly params: CreateScheduleParams;
  signatures: number;
  executed: boolean;
  deleted: boolean;
}

export class MockChainAdapter implements ChainAdapter {
  readonly network = "testnet" as const;

  readonly #now: () => number;
  readonly #requiredSignatures: number;

  #counter = 0;
  readonly #messages = new Map<string, TopicMessage[]>();
  readonly #schedules = new Map<string, MockSchedule>();
  readonly #scheduleKeys = new Map<string, string>();
  readonly #transactions = new Map<string, TransactionRecord>();

  constructor(options: MockChainAdapterOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#requiredSignatures = options.requiredSignatures ?? 2;
  }

  #nextTxId(): string {
    this.#counter += 1;
    return `MOCK-tx-${this.#counter}`;
  }

  #timestamp(): string {
    const millis = this.#now();
    const nanos = String((millis % 1000) * 1_000_000 + this.#counter).padStart(9, "0");
    return `${Math.floor(millis / 1000)}.${nanos.slice(0, 9)}`;
  }

  #record(transactionId: string, consensusTimestamp: string): void {
    this.#transactions.set(transactionId, {
      transactionId,
      status: "SUCCESS",
      consensusTimestamp,
    });
  }

  async submitMessage(topicId: string, contents: string): Promise<ConsensusRef> {
    const existing = this.#messages.get(topicId) ?? [];
    const transactionId = this.#nextTxId();
    const consensusTimestamp = this.#timestamp();
    const sequenceNumber = existing.length + 1;

    existing.push({
      topicId,
      sequenceNumber,
      consensusTimestamp,
      payerAccountId: "MOCK-payer",
      contents,
    });
    this.#messages.set(topicId, existing);
    this.#record(transactionId, consensusTimestamp);

    return { transactionId, consensusTimestamp, sequenceNumber };
  }

  async readMessages(
    topicId: string,
    options: ReadMessagesOptions = {},
  ): Promise<readonly TopicMessage[]> {
    const after = options.afterSequenceNumber ?? 0;
    const found = (this.#messages.get(topicId) ?? []).filter((m) => m.sequenceNumber > after);
    return options.limit === undefined ? found : found.slice(0, options.limit);
  }

  async lockFunds(params: LockFundsParams): Promise<EscrowRef> {
    const transactionId = this.#nextTxId();
    this.#record(transactionId, this.#timestamp());
    return { transactionId, escrowAccountId: `MOCK-escrow-${params.orderId}` };
  }

  async createSchedule(params: CreateScheduleParams): Promise<ScheduleRef> {
    // Mirrors IDENTICAL_SCHEDULE_ALREADY_CREATED: an identical create returns
    // the existing schedule id rather than a second schedule.
    const key = JSON.stringify([
      params.orderId,
      params.escrowAccountId,
      params.payeeAccountId,
      params.amountTinybars,
      params.expiresAt,
    ]);

    const existingId = this.#scheduleKeys.get(key);
    if (existingId !== undefined) {
      const transactionId = this.#nextTxId();
      this.#record(transactionId, this.#timestamp());
      return { transactionId, scheduleId: existingId, alreadyExisted: true };
    }

    const transactionId = this.#nextTxId();
    const scheduleId = `MOCK-schedule-${this.#counter}`;
    this.#record(transactionId, this.#timestamp());
    this.#schedules.set(scheduleId, {
      scheduleId,
      key,
      params,
      signatures: 0,
      executed: false,
      deleted: false,
    });
    this.#scheduleKeys.set(key, scheduleId);

    return { transactionId, scheduleId, alreadyExisted: false };
  }

  async signSchedule(scheduleId: string): Promise<SignScheduleResult> {
    const schedule = this.#schedules.get(scheduleId);
    if (schedule === undefined) {
      throw new MockChainError(`unknown schedule ${scheduleId}`);
    }
    if (schedule.deleted) {
      throw new MockChainError(`schedule ${scheduleId} was deleted and cannot be signed`);
    }

    const transactionId = this.#nextTxId();
    this.#record(transactionId, this.#timestamp());

    // Already executed: report success and change nothing. Payout is an
    // idempotent retry, so a duplicate signature must never pay twice.
    if (schedule.executed) {
      return { transactionId, executed: true };
    }

    schedule.signatures += 1;
    if (schedule.signatures >= this.#requiredSignatures) {
      schedule.executed = true;
    }

    return { transactionId, executed: schedule.executed };
  }

  async deleteSchedule(scheduleId: string): Promise<TxRef> {
    const schedule = this.#schedules.get(scheduleId);
    if (schedule === undefined) {
      throw new MockChainError(`unknown schedule ${scheduleId}`);
    }
    if (schedule.executed) {
      throw new MockChainError(
        `schedule ${scheduleId} already executed; a paid order cannot be clawed back`,
      );
    }

    schedule.deleted = true;
    const transactionId = this.#nextTxId();
    this.#record(transactionId, this.#timestamp());
    return { transactionId };
  }

  async getTransaction(transactionId: string): Promise<TransactionRecord | null> {
    return this.#transactions.get(transactionId) ?? null;
  }

  /** Test-only. Whether a schedule has fired, without going through a mirror read. */
  hasExecuted(scheduleId: string): boolean {
    return this.#schedules.get(scheduleId)?.executed ?? false;
  }
}
