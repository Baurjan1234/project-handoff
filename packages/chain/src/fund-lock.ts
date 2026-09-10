/**
 * The requester-signed fund lock, on real Hedera.
 *
 * `docs/decisions/2026-09-08-requester-signs-the-fund-lock.md`. The server
 * builds a transfer whose **debited account and fee payer are both the
 * requester**, so one signature covers both and the server has nothing to add.
 * The requester signs those bytes on their own machine with the key that
 * already signs the x402 fee. The server validates what comes back against
 * what it asked for, then submits.
 *
 * The server never signs the requester's transfer and never holds their key.
 *
 * The whitelist itself is not here — it lives in `@handoff/schema`'s
 * `assertFundLockMatches`, shared with `MockChainAdapter` so a rejection
 * cannot exist in the fixture P2 builds against and not on the wire. This
 * module is the *decoder*: it turns protobuf into the `FundLockFacts` that
 * validator reads.
 *
 * Every SDK call below was read off `@hiero-ledger/sdk@2.85.0`'s typings
 * rather than recalled — `Transaction.fromBytes`, `hbarTransfersList`,
 * `transactionId.accountId`, `transactionValidDuration`, `transactionMemo`,
 * `getSignatures`. CLAUDE.md's never-recall rule; hallucinated SDK calls are
 * the failure mode the audits flagged.
 */

import {
  AccountId,
  type Client,
  Hbar,
  Status,
  StatusError,
  Transaction,
  TransactionId,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import {
  assertFundLockMatches,
  assertFundLockMemoFits,
  FUND_LOCK_VALID_SECONDS,
  FundLockError,
  FundLockSubmitError,
  formatTinybars,
  parseTinybars,
  assertPositive,
  utcSecondsFrom,
  type EscrowRef,
  type FundLockFacts,
  type LockFundsParams,
  type UnsignedFundLock,
} from "@handoff/schema";

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/**
 * Build the transfer the requester will sign.
 *
 * The transaction id's account **is** the fee payer on Hedera, so generating
 * the id against the requester is what makes them pay their own gas. Verified
 * in the SDK source: `freezeWith` calls `_setTransactionId`, which only throws
 * when neither an id nor an operator is present — it never overwrites an id
 * set beforehand (`Transaction.cjs:1256`). So a client whose operator is the
 * platform can freeze a transaction the requester pays for.
 *
 * `freezeWith(client)` is still needed for the node account ids; passing null
 * would leave the transaction unsubmittable.
 */
export async function buildFundLock(
  client: Client,
  escrowAccountId: AccountId,
  params: LockFundsParams,
): Promise<UnsignedFundLock> {
  // Before anything is frozen. An order id that will not fit the memo is a
  // lock that cannot be built, and the requester should learn that here rather
  // than as MEMO_TOO_LONG at precheck after they have paid the x402 fee.
  const memo = assertFundLockMemoFits(params.orderId);
  const amount = Hbar.fromTinybars(
    formatTinybars(assertPositive(parseTinybars(params.amountTinybars))),
  );
  const requester = AccountId.fromString(params.requesterAccountId);
  const transactionId = TransactionId.generate(requester);

  const frozen = new TransferTransaction()
    .addHbarTransfer(requester, amount.negated())
    .addHbarTransfer(escrowAccountId, amount)
    .setTransactionId(transactionId)
    .setTransactionMemo(memo)
    // 180 explicitly, not Hedera's 120-second default. Between our 402, the
    // client's preflight mirror read and the facilitator's /verify the default
    // is a genuine expiry path rather than an edge case.
    .setTransactionValidDuration(FUND_LOCK_VALID_SECONDS)
    .freezeWith(client);

  return {
    escrowAccountId: escrowAccountId.toString(),
    transactionBytes: toBase64(frozen.toBytes()),
    memo,
    validUntil: validUntilOf(transactionId),
  };
}

/**
 * `validStart + validDuration`, which is when the network stops accepting it.
 *
 * Read off the id we just generated rather than off the clock, so the window
 * the requester is told about is the window the transaction actually has.
 */
function validUntilOf(transactionId: TransactionId): string {
  const validStart = transactionId.validStart;
  if (validStart === null) {
    // Unreachable via TransactionId.generate, which always sets one. Stated
    // rather than asserted with `!`: this is money-path code.
    throw new FundLockError("unparseable", "the generated transaction id carries no valid start");
  }
  return utcSecondsFrom((validStart.seconds.toNumber() + FUND_LOCK_VALID_SECONDS) * 1000);
}

/**
 * Turn returned bytes into what the whitelist reads.
 *
 * Everything here is untrusted: these bytes crossed the wire from whoever
 * called the endpoint. Nothing is compared against `expected` in this
 * function — that is the shared validator's job, and keeping the split means
 * one set of rules rather than two.
 */
export function decodeFundLock(signedTransactionBytes: string): FundLockFacts {
  let parsed: Transaction;
  try {
    parsed = Transaction.fromBytes(Buffer.from(signedTransactionBytes, "base64"));
  } catch (error) {
    throw new FundLockError(
      "unparseable",
      `the signed fund lock is not a Hedera transaction: ${(error as Error).message}`,
    );
  }

  if (!(parsed instanceof TransferTransaction)) {
    throw new FundLockError(
      "not-a-transfer",
      `expected a transfer, got ${parsed.constructor.name}`,
    );
  }

  const transactionId = parsed.transactionId;
  const feePayer = transactionId?.accountId;
  const validStart = transactionId?.validStart;
  if (feePayer == null || validStart == null) {
    throw new FundLockError("unparseable", "the signed fund lock carries no transaction id");
  }

  return {
    // The transaction id's account is the fee payer. There is no separate
    // field for it on Hedera.
    feePayer: feePayer.toString(),
    transfers: parsed.hbarTransfersList.map((leg) => ({
      accountId: leg.accountId.toString(),
      amountTinybars: leg.amount.toTinybars().toString(),
    })),
    memo: parsed.transactionMemo,
    validUntil: utcSecondsFrom(
      (validStart.seconds.toNumber() + parsed.transactionValidDuration) * 1000,
    ),
    signedBy: publicKeysOf(parsed),
    // Public keys, which this server cannot tie to an account id without a
    // mirror read on the money path. So the whitelist counts them and leaves
    // *identity* to consensus, which refuses a wrong signer with
    // INVALID_SIGNATURE and moves nothing. See FundLockFacts.signerIdentity.
    signerIdentity: "opaque",
  };
}

/** Every public key that signed, across every node's copy. */
function publicKeysOf(transaction: Transaction): readonly string[] {
  const keys = new Set<string>();
  for (const perNode of transaction.getSignatures().values()) {
    for (const perTransaction of perNode.values()) {
      for (const publicKey of perTransaction.keys()) {
        keys.add(publicKey.toStringRaw());
      }
    }
  }
  return [...keys];
}

/**
 * Validate the returned bytes against what was asked for, then submit.
 *
 * Two failure classes, deliberately distinguishable. `FundLockError` is the
 * whitelist refusing before anything executes — the caller can fix it or
 * rebuild. `FundLockSubmitError` is the network refusing what was submitted,
 * and a caller cannot tell "escrow funded" from "rejected at precheck"
 * without it.
 */
export async function submitFundLock(
  client: Client,
  escrowAccountId: AccountId,
  expected: LockFundsParams,
  signedTransactionBytes: string,
  now: () => number = Date.now,
): Promise<EscrowRef> {
  assertFundLockMemoFits(expected.orderId);
  const facts = decodeFundLock(signedTransactionBytes);
  assertFundLockMatches(facts, expected, escrowAccountId.toString(), now());

  // Re-parsed rather than carried through the decoder, so nothing submitted is
  // reachable from a value the whitelist did not just approve.
  //
  // **`execute` also puts our operator's signature on this**, because
  // `Transaction._beforeExecute` signs with `client._operator` whenever one is
  // set (Transaction.cjs:1668) and a transaction rebuilt from bytes carries
  // none of its own. The required signature is the requester's — they are the
  // fee payer and the debited account — so ours is superfluous, and Hedera
  // ignores it: verified on testnet 2026-09-10, transaction
  // `0.0.10376659@1789035890.122059080`, SUCCESS, with the operator absent
  // from the transfer list entirely. See
  // ../../../docs/research/x402-first-paid-request.md.
  const transaction = Transaction.fromBytes(Buffer.from(signedTransactionBytes, "base64"));
  const submittedId = transaction.transactionId?.toString();

  try {
    const response = await transaction.execute(client);
    await response.getReceipt(client);
    return {
      transactionId: response.transactionId.toString(),
      escrowAccountId: escrowAccountId.toString(),
    };
  } catch (error) {
    if (!(error instanceof StatusError)) {
      // A socket error or a receipt timeout carries no status, and inventing
      // one would be interpreting the network rather than reporting it. But
      // the transaction may well have landed — a timeout waiting for a receipt
      // says nothing about whether consensus happened — so the id has to come
      // out with it. Never swallow a transaction id, least of all the one that
      // tells you whether the requester's money moved.
      throw new Error(
        `the fund lock was submitted as ${submittedId ?? "an unknown transaction"} and its ` +
          `outcome is unknown: ${(error as Error).message}. Read the mirror node for that ` +
          `id before retrying — a retry inside the receipt period is refused as a duplicate, ` +
          `and past it would lock a second time.`,
        { cause: error },
      );
    }
    const status = error.status;
    throw new FundLockSubmitError(
      status.toString(),
      // On DUPLICATE_TRANSACTION the id in these bytes is the submission that
      // did land, because Hedera keys duplicates on payer plus valid start. A
      // caller retrying a paid request reads the escrow back from it rather
      // than treating the refusal as a failure. Never double-lock.
      submittedId,
      status === Status.DuplicateTransaction
        ? `this fund lock was already submitted as ${submittedId}; the escrow is funded ` +
          `and locking again would take the requester's money twice`
        : `the network refused the fund lock with ${status}`,
    );
  }
}
