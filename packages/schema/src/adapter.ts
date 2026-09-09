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
 *
 * **What "validated against `expected`" does and does not cover.** The amount,
 * the escrow account, the debited account, the fee payer and the signer are
 * each matched against a value the server holds. The validity window is not
 * among them: `LockFundsParams` carries no window, so there is nothing to
 * match it to. It is bounded instead — the instant has to fall inside the
 * window this build would have issued — and beyond that it is the signature
 * and the network that refuse a forged one, with `TRANSACTION_EXPIRED` at
 * precheck. Say it this way round rather than claiming a check that cannot
 * exist.
 */
export interface RequesterFundedEscrow {
  buildFundLock(params: LockFundsParams): Promise<UnsignedFundLock>;

  /**
   * Validate the returned bytes, then submit them.
   *
   * Resolves only when the escrow is funded. It throws `FundLockError` for
   * anything the whitelist refuses before submitting, and
   * `FundLockSubmitError` when the network refuses what was submitted —
   * `INVALID_SIGNATURE` for a doctored lock, `DUPLICATE_TRANSACTION` for a
   * replay, and the latter carries the id of the submission that did land.
   * Without those two being distinguishable a caller cannot tell "escrow
   * funded" from "submitted and rejected at precheck", which is the difference
   * between an order to post and an order to refuse.
   *
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
   * The transaction memo, which carries `order_id` and is what binds this lock
   * to one order.
   *
   * Without it the whitelist collapses to (requester, price, the one shared
   * escrow) — see
   * `docs/decisions/2026-09-07-one-shared-escrow-account-this-week.md` — and
   * two orders at the same price from the same requester are satisfied by the
   * same bytes. The memo is inside the signed body, so a caller cannot move it
   * to another order without invalidating the signature.
   *
   * **This settles the open `orderId` question in favour of minting the id on
   * the first POST and echoing it through the 402.** `buildFundLock` cannot
   * take an optional order id and still bind anything.
   *
   * Hedera caps a transaction memo at 100 bytes (`MEMO_TOO_LONG`); an
   * `ord_`-prefixed uuid is 36, so this fits with room to spare.
   */
  readonly memo: string;
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
  /**
   * The memo does not carry this order's id.
   *
   * The escrow is one shared account, so without this nothing binds a lock to
   * an order: two orders at the same price from the same requester are
   * satisfied by the same bytes. See `UnsignedFundLock.memo`.
   */
  | "wrong-order"
  | "unsigned"
  /** The window has already closed. Rebuild; nothing is wrong with the caller. */
  | "expired"
  /**
   * The window claims to be longer than the server issues.
   *
   * `LockFundsParams` carries no window, so this field is the one thing a
   * validator cannot match against `expected`. It is bounded instead: the
   * instant must fall inside the window this build would have issued. In the
   * real adapter the signature covers the field and a forged one dies at
   * consensus, so this is a cheaper refusal of the same tamper — not the only
   * thing standing between it and the escrow.
   */
  | "window-too-long";

export class FundLockError extends Error {
  constructor(readonly reason: FundLockRejection, message: string) {
    super(message);
    this.name = "FundLockError";
  }
}

/**
 * Hedera refuses a transaction memo over 100 bytes with `MEMO_TOO_LONG`.
 *
 * A bound this package states in a comment is a bound nothing enforces, the
 * same way the HCS message size is checked rather than assumed. `order_id` is
 * the memo, so an id that outgrows this is a fund lock that cannot be built —
 * and the place to find that out is here, not at precheck on the requester's
 * machine after they have already paid the x402 fee.
 *
 * An `ord_`-prefixed uuid is 36 bytes, so today there is room to spare. The
 * check exists for the day somebody makes ids longer.
 */
export const FUND_LOCK_MEMO_MAX_BYTES = 100;

/**
 * The memo an order id produces, refused if it will not fit.
 *
 * Byte length, not string length: a multi-byte character costs Hedera more
 * than one byte and `String.length` counts UTF-16 code units.
 */
export function assertFundLockMemoFits(orderId: string): string {
  const bytes = new TextEncoder().encode(orderId).byteLength;
  if (bytes > FUND_LOCK_MEMO_MAX_BYTES) {
    throw new FundLockError(
      "wrong-order",
      `order id ${JSON.stringify(orderId)} is ${bytes} bytes, over the ` +
        `${FUND_LOCK_MEMO_MAX_BYTES}-byte transaction memo Hedera accepts`,
    );
  }
  return orderId;
}

/**
 * The lock passed the whitelist and the network refused it anyway.
 *
 * Every `FundLockRejection` is decided before submission. This is the other
 * half, and it has to exist as its own type because the design deliberately
 * leans on the network for two guarantees the validator cannot provide:
 *
 * - **Signature validity.** Not checked locally, on purpose; a doctored lock
 *   comes back `INVALID_SIGNATURE` with nothing moved.
 * - **Replay.** Nothing above remembers an in-flight transaction, so the same
 *   signed bytes submitted twice are refused as `DUPLICATE_TRANSACTION` —
 *   within the 180-second receipt period, which is why the window is not
 *   longer than it is.
 *
 * `transactionId` is the id the *first* submission got, when the status names
 * one. On a duplicate that id is the escrow already being funded, so a caller
 * retrying a paid request can read it back rather than treating the refusal as
 * a failure. Payout is an idempotent retry and so is this: never double-lock.
 */
export class FundLockSubmitError extends Error {
  constructor(
    /** The network's response code, verbatim. Never interpreted into a boolean. */
    readonly status: string,
    readonly transactionId: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "FundLockSubmitError";
  }
}
