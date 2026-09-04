/**
 * The ChainAdapter interface.
 *
 * This is the cutover seam. `MockChainAdapter` and the real Hedera adapter in
 * `packages/chain` satisfy the same interface, so Monday night is a one-line
 * swap rather than a rewrite. Nothing outside `packages/chain` imports the
 * Hedera SDK; everything talks to this.
 *
 * Three project rules are enforced by these types rather than by prose:
 *
 * 1. `network` is the literal `"testnet"`. An adapter pointed at mainnet cannot
 *    satisfy this interface.
 * 2. Every operation returns its transaction id. Threading it through is not
 *    optional, because settlement state is read from a mirror node and never
 *    inferred from having sent something.
 * 3. `createSchedule` requires a payee. ScheduleCreate carries a fully formed
 *    inner transaction, so the schedule cannot exist before a claim resolves
 *    who is being paid.
 */

export interface TxRef {
  /** Always surfaced, never swallowed. This is what a Hashscan link is built from. */
  readonly transactionId: string;
}

export interface ConsensusRef extends TxRef {
  /** `seconds.nanoseconds`. The truth about ordering, including who won a claim. */
  readonly consensusTimestamp: string;
  readonly sequenceNumber: number;
}

export interface TopicMessage {
  readonly topicId: string;
  readonly sequenceNumber: number;
  readonly consensusTimestamp: string;
  /** Who paid to submit. For an attestation this is the expert's own account. */
  readonly payerAccountId: string;
  readonly contents: string;
}

export interface ReadMessagesOptions {
  readonly afterSequenceNumber?: number;
  readonly limit?: number;
}

export interface LockFundsParams {
  readonly orderId: string;
  readonly amountTinybars: string;
  readonly requesterAccountId: string;
}

export interface EscrowRef extends TxRef {
  readonly escrowAccountId: string;
}

export interface CreateScheduleParams {
  readonly orderId: string;
  readonly escrowAccountId: string;
  /** Known only at claim time. That is why the schedule is created then. */
  readonly payeeAccountId: string;
  readonly amountTinybars: string;
  /** UTC instant, second precision, `Z` only. */
  readonly expiresAt: string;
}

export interface ScheduleRef extends TxRef {
  readonly scheduleId: string;
  /**
   * True when the network returned an identical existing schedule rather than
   * creating one. This is the idempotency primitive behind never double-paying,
   * so callers should treat it as success rather than as a conflict.
   */
  readonly alreadyExisted: boolean;
}

export interface SignScheduleResult extends TxRef {
  /** True once the signature requirement is met and the transfer has fired. */
  readonly executed: boolean;
}

export type TransactionStatus = "SUCCESS" | "FAILED";

export interface TransactionRecord {
  readonly transactionId: string;
  readonly status: TransactionStatus;
  readonly consensusTimestamp: string;
}

export interface ChainAdapter {
  /** Hard rule 5, in the type system. */
  readonly network: "testnet";

  submitMessage(topicId: string, contents: string): Promise<ConsensusRef>;
  readMessages(topicId: string, options?: ReadMessagesOptions): Promise<readonly TopicMessage[]>;

  lockFunds(params: LockFundsParams): Promise<EscrowRef>;

  createSchedule(params: CreateScheduleParams): Promise<ScheduleRef>;
  /** Idempotent. Signing an already-executed schedule must never pay twice. */
  signSchedule(scheduleId: string): Promise<SignScheduleResult>;
  deleteSchedule(scheduleId: string): Promise<TxRef>;

  /** Settlement is read, never assumed. Null while the mirror node is still catching up. */
  getTransaction(transactionId: string): Promise<TransactionRecord | null>;
}
