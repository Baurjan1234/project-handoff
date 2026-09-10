/**
 * The fund-lock whitelist, and the shape both adapters decode into.
 *
 * The validator lives here rather than beside either adapter because there are
 * two of them and only one set of rules. `MockChainAdapter` decodes base64
 * JSON; `HederaChainAdapter` decodes a protobuf `TransferTransaction`. What
 * they may decode *to* is the same, so the whitelist is written once against
 * that shape and both adapters are held to it by one test suite.
 *
 * Duplicating it was the alternative and it is the worse one: this is the
 * money path, and a whitelist that drifts between the fixture P2 builds
 * against and the adapter that runs on testnet is a rejection that exists in
 * tests and not on the wire.
 *
 * See `docs/decisions/2026-09-08-requester-signs-the-fund-lock.md`.
 */

import { FundLockError, type LockFundsParams } from "./adapter.js";
import { parseTinybars } from "./money.js";

/**
 * Hedera's default transaction validity is 120 seconds and its maximum is 180.
 * Both adapters set 180 explicitly, because between our 402, the client's
 * preflight mirror read and the facilitator's `/verify` the default is a
 * genuine expiry path rather than an edge case.
 */
export const FUND_LOCK_VALID_SECONDS = 180;

/**
 * One hbar leg, the way a real `TransferTransaction` carries them.
 *
 * Signed tinybars: negative debits an account, positive credits one, and the
 * legs of a transfer net to zero. The money module already parses a leading
 * minus and `MIN_TINYBARS` is negative, so direction needs no field of its own.
 */
export interface FundLockLeg {
  readonly accountId: string;
  readonly amountTinybars: string;
}

/**
 * What a decoder has to be able to say about returned bytes.
 *
 * **A list of legs, not a from/to pair.** A single pair cannot express the
 * tamper this whitelist exists for: a second credit riding along to an account
 * of the caller's choosing, with the debit inflated to keep the legs netting
 * to zero. While the shape was a pair, `extra-transfers` was a rejection
 * reason nothing could produce.
 *
 * Whether the bytes are a transfer at all is the decoder's to answer, not this
 * type's — the mock reads a `kind` field, the real adapter asks the SDK
 * whether it parsed a `TransferTransaction` — so both raise `not-a-transfer`
 * before they ever build one of these.
 */
export interface FundLockFacts {
  /** On Hedera this is the transaction id's account. */
  readonly feePayer: string;
  readonly transfers: readonly FundLockLeg[];
  /** Carries `order_id`. The only thing binding a lock to one order. */
  readonly memo: string;
  /** UTC instant, second precision, `Z` only. `validStart + validDuration`. */
  readonly validUntil: string;
  /**
   * Who signed, in whatever identity the decoder can prove.
   *
   * The mock names account ids because it invents its own signatures. The real
   * adapter can only read public keys off the signature map, and the server
   * does not hold the requester's public key — so it reports the keys it saw
   * and leaves *identity* to the network, which refuses a wrong signer with
   * `INVALID_SIGNATURE` at consensus with nothing moved.
   */
  readonly signedBy: readonly string[];
  /**
   * Whether `signedBy` holds account ids the whitelist may compare, or opaque
   * key material it may only count.
   *
   * Explicit rather than sniffed out of the strings. A validator that guesses
   * which identity it was handed is a validator that silently stops checking
   * the day the format shifts, and this one guards the money path.
   */
  readonly signerIdentity: "account" | "opaque";
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
 * Signature *validity* is not checked, in either adapter. The network checks
 * it, and a bad one fails at consensus with nothing moved and the x402 fee
 * still unsettled.
 */
export function assertFundLockMatches(
  facts: FundLockFacts,
  expected: LockFundsParams,
  escrowAccountId: string,
  nowMillis: number,
): void {
  // Before the money checks, because the escrow is one shared account: without
  // this, (requester, price, escrow) is the whole whitelist and a lock built
  // for one order satisfies any other order at the same price.
  if (facts.memo !== expected.orderId) {
    throw new FundLockError(
      "wrong-order",
      `the fund lock is memoed ${JSON.stringify(facts.memo)}, not order ${expected.orderId}`,
    );
  }

  // Parse every leg before classifying any of them. `expected` is ours, so it
  // parses or the caller has a bug. The legs came back over the wire and are
  // strings only — "abc", "1e9", "010000000000" and a 20-digit value all
  // decode and all make the money module throw. A MoneyError escaping here
  // reaches a handler as an unmapped 500 with no reason on it, which is
  // exactly the case this whitelist exists to name.
  const legs = facts.transfers.map((leg) => ({
    accountId: leg.accountId,
    amount: claimedTinybars(leg.amountTinybars),
  }));

  // The count check comes first, because a third leg is the tamper and every
  // check below reads "the" debit and "the" credit as though there is one of
  // each. A lock we issued has exactly two: the requester debited, the escrow
  // credited.
  const debits = legs.filter((leg) => leg.amount < 0n);
  const credits = legs.filter((leg) => leg.amount > 0n);
  if (legs.length !== 2 || debits.length !== 1 || credits.length !== 1) {
    throw new FundLockError(
      "extra-transfers",
      `a fund lock is one debit and one credit; this moves ${legs.length} legs ` +
        `(${legs.map((leg) => `${leg.accountId} ${leg.amount.toString()}`).join(", ")})`,
    );
  }

  // Non-null: the length checks above prove there is exactly one of each.
  const debit = debits[0] as { accountId: string; amount: bigint };
  const credit = credits[0] as { accountId: string; amount: bigint };
  const price = parseTinybars(expected.amountTinybars);

  if (debit.accountId !== expected.requesterAccountId) {
    throw new FundLockError(
      "wrong-debited-account",
      `the debited account is ${debit.accountId}, not the requester ${expected.requesterAccountId}`,
    );
  }
  if (facts.feePayer !== expected.requesterAccountId) {
    throw new FundLockError(
      "wrong-fee-payer",
      `the fee payer is ${facts.feePayer}, not the requester ${expected.requesterAccountId}`,
    );
  }
  if (credit.accountId !== escrowAccountId) {
    throw new FundLockError(
      "wrong-escrow-account",
      `the credited account is ${credit.accountId}, not the escrow ${escrowAccountId}`,
    );
  }
  // Both sides, not just the credit. A lock that credits the escrow correctly
  // while debiting more than the order is priced at is still the caller losing
  // money they did not agree to lose.
  if (credit.amount !== price || debit.amount !== -price) {
    throw new FundLockError(
      "wrong-amount",
      `the transfer debits ${debit.amount.toString()} and credits ${credit.amount.toString()} ` +
        `tinybars, not the ${expected.amountTinybars} the order is priced at`,
    );
  }
  if (facts.signedBy.length === 0) {
    throw new FundLockError("unsigned", "the fund lock came back without a signature");
  }
  // Reachable only for a decoder that can name its signers — see
  // `FundLockFacts.signerIdentity`. The real adapter reads public keys it
  // cannot tie to an account id without a mirror read on the money path, so it
  // reports them as opaque and leaves this one refusal to consensus.
  if (
    facts.signerIdentity === "account" &&
    !facts.signedBy.includes(expected.requesterAccountId)
  ) {
    throw new FundLockError(
      "wrong-signer",
      `the fund lock is signed by ${facts.signedBy.join(", ")}, not by the requester ${expected.requesterAccountId}`,
    );
  }
  // The window is the one field with nothing in `expected` to compare against,
  // so it is bounded rather than matched: it must lie inside the window this
  // adapter would have issued had it built the lock now. Reading the claim and
  // only asking "has it passed?" accepts a forged `validUntil` of the year
  // 3000 — in the real adapter the signature covers the field and the network
  // refuses it, but this is what P2 builds against and a validator that waves
  // the tamper through teaches the wrong contract.
  const claimedValidUntil = Date.parse(facts.validUntil);
  if (Number.isNaN(claimedValidUntil)) {
    throw new FundLockError(
      "unparseable",
      `the fund lock's validity window ${JSON.stringify(facts.validUntil)} is not an instant`,
    );
  }
  if (claimedValidUntil <= nowMillis) {
    throw new FundLockError(
      "expired",
      `the fund lock stopped being submittable at ${facts.validUntil}`,
    );
  }
  if (claimedValidUntil > nowMillis + FUND_LOCK_VALID_SECONDS * 1000) {
    throw new FundLockError(
      "window-too-long",
      `the fund lock claims to stay submittable until ${facts.validUntil}, which is ` +
        `longer than the ${FUND_LOCK_VALID_SECONDS}s this adapter issues`,
    );
  }
}

/** UTC instant, second precision, `Z` only — the shape `UnsignedFundLock` promises. */
export function utcSecondsFrom(epochMillis: number): string {
  return `${new Date(Math.floor(epochMillis / 1000) * 1000).toISOString().slice(0, 19)}Z`;
}
