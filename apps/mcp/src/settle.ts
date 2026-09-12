/**
 * SETTLED — the escrow releasing to the expert.
 *
 * This is the last beat of the lifecycle and the only one that was missing: an
 * order could be posted, claimed and delivered, and the money stayed in escrow
 * because nothing validated the attestation and asked the adapter to co-sign.
 * `live-happy-path.ts` did it by hand; nothing did it for a real order.
 *
 * **An explicit call, not a watcher.** A background loop re-scanning the
 * attestations topic would, after any restart, meet orders it had already paid
 * with an empty `PendingPayoutStore` and pay them again. The adapter now asks
 * the mirror node before paying (`findPayout`), so a second call is safe — but
 * "safe when retried" is a reason to let a caller retry, not a reason to retry
 * on a timer. The expert app calls this after publishing, and so does the demo.
 *
 * **Reads are authoritative; the request body is not.** The caller passes an
 * order id and nothing else. Everything the payout is computed from — who
 * claimed, what they signed, what the order is priced at — comes back off the
 * public topics.
 *
 * Three rules are load-bearing here rather than decorative.
 *
 * **The verdict is never branched on.** A reject is a delivered product and
 * gets paid (hard rule 3). There is deliberately no `if (verdict === ...)` in
 * this file.
 *
 * **Only the claimant's attestation pays.** The attestations topic carries no
 * submit key, so anyone can publish anything about any order. A stray
 * attestation is noise, not a violation: it must not pay, and it must not stop
 * the real one from paying either.
 *
 * **A schema violation is mechanical or it is not a violation.** The only
 * clawback path is a provable schema failure — a hash the class forbids, a
 * hash that does not match the artifact the order named. A disagreement about
 * the work is never one (hard rule 4).
 */

import {
  assertPositive,
  parseTinybars,
  type Attestation,
  type ChainAdapter,
  type OrderEnvelope,
} from "@handoff/schema";
import { readOrderFacts, type AttestationRecord, type StatusDeps } from "./status.js";

export interface SettleDeps extends StatusDeps {
  readonly chain: ChainAdapter;
  /** The one shared escrow. Configuration to this process, never something it invents. */
  readonly escrowAccountId: string;
}

/**
 * Why a settle did not pay.
 *
 * `not-ready` and `violation` are different answers to a caller and have to
 * stay distinguishable. `not-ready` means try again — the mirror node lags
 * about six seconds behind consensus, so an expert who calls this the instant
 * they publish will legitimately see it. `violation` means never: the money
 * does not move and this order is over.
 */
export type SettleRefusal =
  | { readonly kind: "not-ready"; readonly state: string; readonly message: string }
  | { readonly kind: "violation"; readonly message: string };

export class SettleError extends Error {
  constructor(readonly refusal: SettleRefusal) {
    super(refusal.message);
    this.name = "SettleError";
  }
}

export interface SettlementResult {
  readonly orderId: string;
  readonly state: "SETTLED";
  /** The co-signed transfer that moved the money. Read it on a mirror node; never infer it. */
  readonly payoutTransactionId: string;
  readonly payeeAccountId: string;
  readonly amountTinybars: string;
  /**
   * True when this process already had a payout recorded for these exact
   * parameters.
   *
   * A hint, not the guarantee. The guarantee is the adapter's, and it is a
   * mirror read: this flag is false after a restart even for an order that was
   * paid, and the payout still does not happen twice. Never present it to a
   * caller as "we checked".
   */
  readonly alreadyRecorded: boolean;
}

/**
 * `review` only, and the mechanical checks that make an attestation payable.
 *
 * TODO(NAS): this cross-check belongs beside the schemas it compares, in
 * `@handoff/schema` next to `Attestation` and `OrderEnvelope`, so the expert
 * app refuses to *build* what this refuses to *pay*. P4's lane; it lives here
 * until then, and the verifier is the end that must have it.
 */
function assertAttestationMatchesOrder(attestation: Attestation, envelope: OrderEnvelope): void {
  if (attestation.class !== envelope.class) {
    throw new SettleError({
      kind: "violation",
      message:
        `the attestation is class "${attestation.class}" and the order is class ` +
        `"${envelope.class}". The class is declared at order time and never changes.`,
    });
  }

  // `review` sets artifact_hash_in only, never artifact_hash_out. The union in
  // @handoff/schema already made the wrong shape unparsable, so what is left
  // to check is that the right shape names the right artifact.
  if (attestation.class === "review" && envelope.class === "review") {
    if (attestation.artifact_hash_in !== envelope.artifact_hash_in) {
      throw new SettleError({
        kind: "violation",
        message:
          `the attestation pins artifact ${attestation.artifact_hash_in}, and the order ` +
          `named ${envelope.artifact_hash_in}. It is a verdict on something else.`,
      });
    }
  }

  if (attestation.cert_tag !== envelope.cert_tag) {
    throw new SettleError({
      kind: "violation",
      message:
        `the attestation is signed under credential "${attestation.cert_tag}" and the order ` +
        `routed to "${envelope.cert_tag}".`,
    });
  }
}

/** Epoch seconds → the schema's `Utc` shape: second precision, `Z` only. */
function epochSecondsToUtc(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Validate the delivery and release the escrow.
 *
 * Throws `SettleError` when it refuses. Anything else escaping is the chain or
 * the mirror node failing, and the caller needs to see it rather than a
 * flattened "could not settle".
 */
export async function settleOrder(orderId: string, deps: SettleDeps): Promise<SettlementResult> {
  const facts = await readOrderFacts(orderId, deps);

  const posted = facts.posted;
  if (posted === undefined) {
    // Not a 404. The mirror node lags behind consensus, so "we cannot see it"
    // is the honest answer and "it does not exist" is a guess.
    throw new SettleError({
      kind: "not-ready",
      state: "UNKNOWN",
      message: `order ${orderId} is not visible on the orders topic yet.`,
    });
  }

  if (facts.holder?.state !== "claimed") {
    throw new SettleError({
      kind: "not-ready",
      state: facts.holder?.state === "claim_timeout" ? "CLAIM_TIMEOUT" : "POSTED",
      message:
        `order ${orderId} is not held by anybody, so there is nobody to pay. ` +
        `The payout is committed at claim.`,
    });
  }
  const held = facts.holder.active;

  // The claimant's own, and only theirs. On a topic with no submit key the
  // last attestation for an order is whoever submitted last, which is not a
  // basis for moving money. A stray one is ignored here rather than treated as
  // a violation: it did not come from the party under obligation, so it says
  // nothing about whether they delivered.
  const delivered: AttestationRecord | undefined = facts.attestations
    .filter((record) => record.payerAccountId === held.claimantAccountId)
    .at(-1);

  if (delivered === undefined) {
    throw new SettleError({
      kind: "not-ready",
      state: "CLAIMED",
      message:
        `order ${orderId} is held by ${held.claimantAccountId} and no attestation from that ` +
        `account is on the topic yet. The mirror node lags a few seconds behind consensus.`,
    });
  }

  assertAttestationMatchesOrder(delivered.attestation, posted.envelope);

  // Straight off the envelope, as a string, with no conversion anywhere in
  // this file. The price is what the requester locked; nothing here recomputes
  // it, and `assertPositive` is the one guard against an envelope that somehow
  // carries a zero.
  const amountTinybars = posted.envelope.price_tinybars;
  assertPositive(parseTinybars(amountTinybars));

  // Derived from on-chain facts, never from this process's clock. The pending
  // payout's id is a hash of these parameters, so a value that moved between
  // two calls would mint a second record for the same order.
  const expiresAt = epochSecondsToUtc(held.signByEpochSeconds);

  const schedule = await deps.chain.createSchedule({
    orderId,
    escrowAccountId: deps.escrowAccountId,
    payeeAccountId: held.claimantAccountId,
    amountTinybars,
    expiresAt,
  });

  // Signing is a loop because the two adapters accumulate signatures
  // differently and the interface hides which: the real one holds both
  // platform keys and co-signs one transfer, so it executes on the first call,
  // while MockChainAdapter models the 2-of-3 threshold and needs one call per
  // signature. Bounded, so a mock that never executes fails loudly instead of
  // spinning. Every call is idempotent, so the extra ones move no money.
  let signed = await deps.chain.signSchedule(schedule.scheduleId);
  for (let attempt = 1; !signed.executed && attempt < MAX_SIGNATURES; attempt += 1) {
    signed = await deps.chain.signSchedule(schedule.scheduleId);
  }
  if (!signed.executed) {
    throw new Error(
      `the payout for order ${orderId} did not execute after ${MAX_SIGNATURES} signatures ` +
        `(schedule ${schedule.scheduleId}, last transaction ${signed.transactionId}). Read the ` +
        `escrow's transfers on the mirror node before retrying.`,
    );
  }

  return {
    orderId,
    state: "SETTLED",
    payoutTransactionId: signed.transactionId,
    payeeAccountId: held.claimantAccountId,
    amountTinybars,
    alreadyRecorded: schedule.alreadyExisted,
  };
}

/** The escrow is 2-of-3; nothing legitimate needs more than that many calls. */
const MAX_SIGNATURES = 3;
