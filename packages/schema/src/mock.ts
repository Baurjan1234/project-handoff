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

import { FundLockError } from "./adapter.js";
import type {
  ChainAdapter,
  ConsensusRef,
  CreateScheduleParams,
  EscrowRef,
  LockFundsParams,
  ReadMessagesOptions,
  RequesterFundedEscrow,
  ScheduleRef,
  SignScheduleResult,
  TopicMessage,
  TransactionRecord,
  TxRef,
  UnsignedFundLock,
} from "./adapter.js";
import { parseTinybars } from "./money.js";

/**
 * Hedera's default transaction validity is 120 seconds and its maximum is 180.
 * The real adapter sets 180 explicitly, because between our 402, the client's
 * preflight mirror read and the facilitator's `/verify` the default is a
 * genuine expiry path rather than an edge case. The mock uses the same number
 * so callers exercise the same window.
 */
export const FUND_LOCK_VALID_SECONDS = 180;

/** The mock's stand-in for a frozen `TransferTransaction`. Never protobuf. */
interface FakeTransfer {
  readonly kind: string;
  readonly feePayer: string;
  readonly from: string;
  readonly to: string;
  readonly amountTinybars: string;
  readonly validUntil: string;
  readonly signedBy: readonly string[];
}

function utcSecondsFrom(epochMillis: number): string {
  return `${new Date(Math.floor(epochMillis / 1000) * 1000).toISOString().slice(0, 19)}Z`;
}

function encodeFakeTransfer(transfer: FakeTransfer): string {
  return btoa(JSON.stringify(transfer));
}

function isFakeTransfer(value: unknown): value is FakeTransfer {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["kind"] === "string" &&
    typeof candidate["feePayer"] === "string" &&
    typeof candidate["from"] === "string" &&
    typeof candidate["to"] === "string" &&
    typeof candidate["amountTinybars"] === "string" &&
    typeof candidate["validUntil"] === "string" &&
    Array.isArray(candidate["signedBy"]) &&
    candidate["signedBy"].every((entry) => typeof entry === "string")
  );
}

function decodeFakeTransfer(transactionBytes: string): FakeTransfer {
  let parsed: unknown;
  try {
    parsed = JSON.parse(atob(transactionBytes));
  } catch {
    throw new FundLockError("unparseable", "the signed fund lock is not decodable");
  }
  if (!isFakeTransfer(parsed)) {
    throw new FundLockError("unparseable", "the signed fund lock is missing fields");
  }
  return parsed;
}

/**
 * The requester side of the exchange, so a test or the web demo seeder can
 * play it. In the real flow this happens on the requester's machine with the
 * key that already signs the x402 fee, and the server never has it.
 */
export function signFundLock(transactionBytes: string, signerAccountId: string): string {
  const transfer = decodeFakeTransfer(transactionBytes);
  if (transfer.signedBy.includes(signerAccountId)) return transactionBytes;
  return encodeFakeTransfer({ ...transfer, signedBy: [...transfer.signedBy, signerAccountId] });
}

/**
 * A tinybar figure read out of the returned bytes.
 *
 * The money module is right to throw on a string that is not a tinybar
 * integer, but a `MoneyError` out of the whitelist is a tamper that arrives at
 * the caller as something other than a `FundLockError` — no `reason`, nothing
 * to map to a 400. Untrusted input gets the refusal it earned instead.
 */
function claimedTinybars(value: string): bigint {
  try {
    return parseTinybars(value);
  } catch {
    throw new FundLockError(
      "wrong-amount",
      `the transfer's amount ${JSON.stringify(value)} is not a tinybar figure`,
    );
  }
}

/**
 * The whitelist. Everything the returned bytes are allowed to be, checked
 * against what the server asked for — never against what the bytes claim.
 *
 * Signature *validity* is not checked, here or in the real adapter. The
 * network checks it, and a bad one fails at consensus with nothing moved.
 */
function assertFundLockMatches(
  transfer: FakeTransfer,
  expected: LockFundsParams,
  escrowAccountId: string,
  nowMillis: number,
): void {
  if (transfer.kind !== "transfer") {
    throw new FundLockError("not-a-transfer", `expected a transfer, got ${transfer.kind}`);
  }
  if (transfer.from !== expected.requesterAccountId) {
    throw new FundLockError(
      "wrong-debited-account",
      `the debited account is ${transfer.from}, not the requester ${expected.requesterAccountId}`,
    );
  }
  if (transfer.feePayer !== expected.requesterAccountId) {
    throw new FundLockError(
      "wrong-fee-payer",
      `the fee payer is ${transfer.feePayer}, not the requester ${expected.requesterAccountId}`,
    );
  }
  if (transfer.to !== escrowAccountId) {
    throw new FundLockError(
      "wrong-escrow-account",
      `the credited account is ${transfer.to}, not the escrow ${escrowAccountId}`,
    );
  }
  // `expected` is ours, so it parses or the caller has a bug. The transfer's
  // figure came back over the wire and is a string only — "abc", "1e9",
  // "010000000000" and a 20-digit value all satisfy `isFakeTransfer` and all
  // make the money module throw. A MoneyError escaping here is a tamper that
  // reaches a handler as an unmapped 500 with no reason on it, which is
  // exactly the case this whitelist exists to name.
  if (claimedTinybars(transfer.amountTinybars) !== parseTinybars(expected.amountTinybars)) {
    throw new FundLockError(
      "wrong-amount",
      `the transfer moves ${transfer.amountTinybars} tinybars, not the ${expected.amountTinybars} the order is priced at`,
    );
  }
  if (transfer.signedBy.length === 0) {
    throw new FundLockError("unsigned", "the fund lock came back without a signature");
  }
  if (!transfer.signedBy.includes(expected.requesterAccountId)) {
    throw new FundLockError(
      "wrong-signer",
      `the fund lock is signed by ${transfer.signedBy.join(", ")}, not by the requester ${expected.requesterAccountId}`,
    );
  }
  // The window is the one field with nothing in `expected` to compare against,
  // so it is bounded rather than matched: it must lie inside the window this
  // adapter would have issued had it built the lock now. Reading the claim and
  // only asking "has it passed?" accepts a forged `validUntil` of the year
  // 3000 — in the real adapter the signature covers the field and the network
  // refuses it, but this fixture is what P1 implements from and a mock that
  // waves the tamper through teaches the wrong contract.
  const claimedValidUntil = Date.parse(transfer.validUntil);
  if (Number.isNaN(claimedValidUntil)) {
    throw new FundLockError(
      "unparseable",
      `the fund lock's validity window ${JSON.stringify(transfer.validUntil)} is not an instant`,
    );
  }
  if (claimedValidUntil <= nowMillis) {
    throw new FundLockError(
      "expired",
      `the fund lock stopped being submittable at ${transfer.validUntil}`,
    );
  }
  if (claimedValidUntil > nowMillis + FUND_LOCK_VALID_SECONDS * 1000) {
    throw new FundLockError(
      "window-too-long",
      `the fund lock claims to stay submittable until ${transfer.validUntil}, which is ` +
        `longer than the ${FUND_LOCK_VALID_SECONDS}s this adapter issues`,
    );
  }
}

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

export class MockChainAdapter implements ChainAdapter, RequesterFundedEscrow {
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

  #append(topicId: string, payerAccountId: string, contents: string): ConsensusRef {
    const existing = this.#messages.get(topicId) ?? [];
    const transactionId = this.#nextTxId();
    const consensusTimestamp = this.#timestamp();
    const sequenceNumber = existing.length + 1;

    existing.push({ topicId, sequenceNumber, consensusTimestamp, payerAccountId, contents });
    this.#messages.set(topicId, existing);
    this.#record(transactionId, consensusTimestamp);

    return { transactionId, consensusTimestamp, sequenceNumber };
  }

  async submitMessage(topicId: string, contents: string): Promise<ConsensusRef> {
    return this.#append(topicId, "MOCK-payer", contents);
  }

  /** The claimant pays, so the claimant is the payer. That is the whole point of the method. */
  async publishClaim(topicId: string, claimantAccountId: string, contents: string): Promise<ConsensusRef> {
    return this.#append(topicId, claimantAccountId, contents);
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


  /**
   * PROPOSAL. Builds the transfer the requester will sign. See
   * `RequesterFundedEscrow`.
   *
   * The mock's "bytes" are base64 JSON, not protobuf, and its signature is a
   * marker rather than a real one. That is on purpose: what this fixture has
   * to exercise is the *shape* of the exchange and every way it can be
   * refused, so `submitFundLock` has something to reject. Signature
   * cryptography belongs to the network and to `packages/chain`.
   */
  async buildFundLock(params: LockFundsParams): Promise<UnsignedFundLock> {
    const validUntil = utcSecondsFrom(this.#now() + FUND_LOCK_VALID_SECONDS * 1000);
    const escrowAccountId = `MOCK-escrow-${params.orderId}`;

    return {
      escrowAccountId,
      transactionBytes: encodeFakeTransfer({
        kind: "transfer",
        feePayer: params.requesterAccountId,
        from: params.requesterAccountId,
        to: escrowAccountId,
        amountTinybars: params.amountTinybars,
        validUntil,
        signedBy: [],
      }),
      validUntil,
    };
  }

  async submitFundLock(
    expected: LockFundsParams,
    signedTransactionBytes: string,
  ): Promise<EscrowRef> {
    const escrowAccountId = `MOCK-escrow-${expected.orderId}`;
    const transfer = decodeFakeTransfer(signedTransactionBytes);

    assertFundLockMatches(transfer, expected, escrowAccountId, this.#now());

    const transactionId = this.#nextTxId();
    this.#record(transactionId, this.#timestamp());
    return { transactionId, escrowAccountId };
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
