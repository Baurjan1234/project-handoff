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

  /**
   * Publish a claim on the orders topic **from the claimant's own account**.
   *
   * This is not `submitMessage` with a different body. `submitMessage` pays
   * with whatever account the adapter was built with; a claim has to be paid
   * by the expert, because the payer account *is* the claimant and readers
   * take it from the topic message, never from the body. The real adapter
   * signs with the expert's key and nothing else, the same as an attestation.
   * The mock records `claimantAccountId` as the payer.
   */
  publishClaim(topicId: string, claimantAccountId: string, contents: string): Promise<ConsensusRef>;

  lockFunds(params: LockFundsParams): Promise<EscrowRef>;

  createSchedule(params: CreateScheduleParams): Promise<ScheduleRef>;
  /** Idempotent. Signing an already-executed schedule must never pay twice. */
  signSchedule(scheduleId: string): Promise<SignScheduleResult>;
  deleteSchedule(scheduleId: string): Promise<TxRef>;

  /** Settlement is read, never assumed. Null while the mirror node is still catching up. */
  getTransaction(transactionId: string): Promise<TransactionRecord | null>;
}

/**
 * PROPOSAL, not yet part of `ChainAdapter`. See
 * `docs/decisions/` once Nasaa rules on it; until then this interface is
 * implemented by `MockChainAdapter` alone and nothing in the money path calls
 * it.
 *
 * `lockFunds` debits whatever account the adapter's client signs as, which in
 * every server-side deployment is the platform operator. So the escrow is
 * funded by us, not by the requester, and a public endpoint is drainable: the
 * caller spends the x402 fee and we spend the whole order value. This
 * interface is the fix. It splits the lock into a build the server does and a
 * signature only the requester can produce.
 *
 * 1. `buildFundLock` freezes a transfer whose debited account **and fee payer**
 *    are both the requester, so one signature covers both, and hands back the
 *    bytes. The server never signs it.
 * 2. The requester signs those bytes with the key that already signs the x402
 *    fee, on their own machine.
 * 3. `submitFundLock` validates the returned bytes against what was asked for
 *    and submits them. It never trusts them: the bytes come back over the wire
 *    and a caller who edits the amount, the payee or the payer must be
 *    rejected before anything is executed.
 *
 * Signature *validity* is deliberately not checked here. The network checks
 * it, a bad signature fails at consensus, and by then nothing has moved and
 * the x402 fee is still unsettled — the same verify-gates-serving,
 * settle-last ordering the payment gate already relies on.
 */
export interface RequesterFundedEscrow {
  buildFundLock(params: LockFundsParams): Promise<UnsignedFundLock>;

  /**
   * @param expected what the server asked for, so the validator has something
   * to compare the returned bytes against. Never taken from the bytes.
   * @param signedTransactionBytes base64, as returned by the requester.
   */
  submitFundLock(expected: LockFundsParams, signedTransactionBytes: string): Promise<EscrowRef>;
}

export interface UnsignedFundLock {
  readonly escrowAccountId: string;
  /** base64 protobuf of the frozen, unsigned transfer. */
  readonly transactionBytes: string;
  /**
   * UTC instant, second precision, `Z` only. A frozen Hedera transaction stops
   * being submittable at `validStart + validDuration`, so the server can hand
   * back a fresh challenge instead of burning a round trip on
   * TRANSACTION_EXPIRED.
   */
  readonly validUntil: string;
}

/** Why `submitFundLock` refused. Every case is a mismatch the caller can fix or a stale build. */
export type FundLockRejection =
  | "unparseable"
  | "not-a-transfer"
  | "wrong-amount"
  | "wrong-escrow-account"
  /**
   * The debited account is not the requester, and the signer is not the
   * requester, are two different mistakes with two different fixes: one built
   * the transfer against the wrong account, the other signed with the wrong
   * key. A single `wrong-requester` could not tell a client which it was.
   */
  | "wrong-debited-account"
  | "wrong-signer"
  | "wrong-fee-payer"
  | "extra-transfers"
  | "unsigned"
  | "expired";

export class FundLockError extends Error {
  constructor(readonly reason: FundLockRejection, message: string) {
    super(message);
    this.name = "FundLockError";
  }
}
