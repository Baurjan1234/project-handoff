/**
 * What the requester's agent actually reads.
 *
 * The agent's UI is this copy — there is no other surface on the requester
 * side — so it lives in one module, tested, rather than inline in a handler.
 * The blocks come from `docs/design-system.md` under "MCP replies" and the
 * reasoning from
 * `../../../docs/decisions/2026-09-06-ux-fixes-from-persona-and-laws.md`.
 *
 * Three rules from that document are load-bearing here, not decorative.
 *
 * **"Locked" without what unlocks it reads as gone.** The refund condition is
 * the trust anchor, so beat 3 always carries it.
 *
 * **Never "paid 100.5 HBAR".** The fee and the escrow are different rails and
 * different sizes; adding them into one figure is the single most misleading
 * thing this surface could say. Two labeled lines, fee first and smaller.
 *
 * **Clocks are times, never countdowns.** A countdown invites refreshing; a
 * time is a fact. Rendered in UTC and labeled as such, because the deadline is
 * a UTC instant and an unlabeled hour is a different hour to whoever is
 * reading it.
 *
 * Every first-contact failure ends "Nothing was charged."
 */

import { parseTinybars, tinybarsToDisplay } from "@handoff/schema";
import type { CertTagOption } from "./config.js";

/**
 * `2026-09-14T18:00:00Z` to `18:00 UTC`.
 *
 * The design system writes this as "18:00". The zone is added because the
 * deadline is a UTC instant and the requester is not promised to be in UTC —
 * an unlabeled hour is the kind of thing that reads fine on camera and is
 * wrong for a real user.
 */
export function clockTime(utcInstant: string): string {
  const at = new Date(utcInstant);
  if (Number.isNaN(at.getTime())) {
    return utcInstant;
  }
  const hours = String(at.getUTCHours()).padStart(2, "0");
  const minutes = String(at.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes} UTC`;
}

/**
 * Tinybars to a figure a person reads, through the money module only.
 *
 * `tinybarsToDisplay` already carries the unit. Appending one here produced
 * "42 HBAR HBAR", which is the whole reason nothing outside the money module
 * is allowed to format an amount.
 */
function hbar(tinybars: string): string {
  return tinybarsToDisplay(parseTinybars(tinybars));
}

function labels(tags: readonly CertTagOption[]): string {
  return tags.map((tag) => tag.label).join(", ");
}

export interface PostedReply {
  readonly orderId: string;
  readonly priceTinybars: string;
  readonly deadline: string;
  readonly certTagLabel: string;
  /** Absent when settlement did not land; the fee row then says so. */
  readonly feeTinybars?: string;
  readonly feeError?: string;
  /**
   * The Hedera transaction the facilitator's `/settle` submitted. The only id
   * the fee leg produces, and the only thing that proves the fee was settled
   * rather than merely verified — `/verify` has passed for a payload whose key
   * did not control the payer. Absent when settlement did not land.
   */
  readonly feeTransactionId?: string;
  /** The transaction that moved the order value into escrow. */
  readonly fundLockTransactionId?: string;
}

/**
 * Beat 3, with the beat-2 fee proof row above it.
 *
 * The fee row comes first and smaller, the escrow line second and heavier,
 * because a requester who has just watched two numbers move needs to see which
 * one was spent and which one is being held. Two rails, two amounts, never
 * "paid 100.5 HBAR".
 *
 * **Both proof rows carry their transaction id**, which is the design system's
 * instruction for this message and the repo's standing rule: every Hedera call
 * surfaces its id, threaded rather than swallowed. The ids are what a requester
 * — or a reviewer watching a recording — opens on a mirror node. Without them
 * the reply asserts that money moved and offers nothing to check it against.
 */
export function postedReply(reply: PostedReply): string {
  const fee =
    reply.feeTinybars === undefined
      ? `Service fee not settled · ${reply.feeError ?? "the facilitator did not confirm it"}`
      : `Service fee settled · ${hbar(reply.feeTinybars)} · ` +
        // Settled with no id is a real path, not a bug: the facilitator can
        // report success and return no transaction. "Settled" stays, because
        // it is what the facilitator said and the order did post — but the
        // absence is named rather than rendered as a shorter, quieter line
        // that reads identically to a settlement somebody can check.
        (reply.feeTransactionId === undefined
          ? "settlement id not returned"
          : `tx ${reply.feeTransactionId}`);

  return [
    fee,
    "",
    `Order posted · #${reply.orderId}`,
    `${hbar(reply.priceTinybars)} locked in escrow for the review.` +
      (reply.fundLockTransactionId === undefined ? "" : ` Lock tx ${reply.fundLockTransactionId}`),
    "It pays the reviewer when they sign, whatever the verdict. " +
      `If nobody claims it by ${clockTime(reply.deadline)}, it returns to you.`,
    `Visible to reviewers holding: ${reply.certTagLabel}. Cannot be cancelled once posted.`,
  ].join("\n");
}

/**
 * Beats 4–9, the wait. One answer, not a loop.
 *
 * It names the credential the order routes to, never "a certified reviewer".
 * Routing is all the tag does — no registry checks that anybody holds it — and
 * `../../../docs/decisions/2026-09-08-copy-claims-no-check-that-did-not-run.md`
 * bans the word on this surface until one runs. `docs/design-system.md` already
 * writes the line this way; only the code had drifted.
 */
export function waitingReply(deadline: string, certTagLabel: string): string {
  return `Posted · waiting for a ${certTagLabel}. Open until ${clockTime(deadline)}.`;
}

/**
 * The middle state, in the design system's own words.
 *
 * `docs/design-system.md` writes this line as "Claimed by account 0.0.x ·
 * under review · sign by 18:12 UTC", and said it needed an on-wire claim
 * message first. It has one: the claim envelope is in `@handoff/schema` and
 * `readOrderStatus` resolves the holder with the treaty's own rule.
 *
 * **It does not say "a certified reviewer", for the reason `deliveredReply`
 * does not.** The claim carries a cert tag the claimant asserted and no
 * registry checks it, so the account is what is known and the account is what
 * is named.
 */
export interface ClaimedReply {
  readonly claimedBy: string;
  /** When the claim expires. UTC, second precision. */
  readonly signBy: string;
}

export function claimedReply(reply: ClaimedReply): string {
  return `Claimed by account ${reply.claimedBy} · under review · sign by ${clockTime(reply.signBy)}.`;
}

/**
 * The fallback for a reader that cannot see claims at all.
 *
 * `claimReadable` is false only when something is misconfigured — a topic id
 * pointing somewhere claims are not published, say. Saying so in one line is
 * better than a requester reading "waiting" and concluding nobody has taken
 * their order, which is the one wrong inference available here.
 */
export const CLAIM_NOT_READABLE =
  "Whether a reviewer has claimed it is not readable from here. The signed " +
  "verdict appears here when it lands.";

export interface DeliveredReply {
  readonly verdict: string;
  readonly signedBy: string;
  /** The credential the attestation claims. Self-asserted, not checked. */
  readonly certTag?: string;
}

/**
 * The close, in the form status can honestly carry today.
 *
 * The full beat-10 close — defect codes inline, the reviewer's notes from the
 * content store, the money line — is NAS-37. This says the judgment exists and
 * who signed it, and points at the rest rather than pretending it is here.
 *
 * **It does not say "a certified reviewer", and the design system's line does.**
 * That is a deliberate deviation and the reason is the honesty rule. The
 * attestations topic carries no submit key on purpose, so any account can
 * publish an attestation-shaped message naming somebody else's order id, and
 * the registry that would tell us whether the signer holds the credential is
 * not live (NAS-27). Nothing between that topic and this string checks
 * certification, so calling the signer certified would be the product asserting
 * something it did not verify, to the one person paying for it to be true.
 *
 * What is actually known is the account that paid to submit the message, and
 * what the message claims about itself. Both are said, and the difference is
 * named. The line goes back to the design system's wording the day the registry
 * check exists.
 */
export function deliveredReply(reply: DeliveredReply): string {
  return [
    `Verdict: ${reply.verdict}`,
    `Signed by account ${reply.signedBy} · published forever`,
    reply.certTag === undefined
      ? "The signer's credential is not checked against a registry in this build."
      : `Credential claimed: ${reply.certTag}. Not checked against a registry in this build.`,
  ].join("\n");
}

/** Nothing on the topics matches. Not the same as "it does not exist". */
export const NOT_VISIBLE_YET =
  "No order with that id is visible on the topics yet. A mirror node runs a few " +
  "seconds behind consensus, so a freshly posted order can read this way.";

/**
 * The unknown-tag failure.
 *
 * It happens at post time, before the fee settles, which verify-before-settle
 * guarantees. The reply names the credential in the words a person chose, not
 * the code an envelope carries.
 */
export function unknownTagReply(asked: string, available: readonly CertTagOption[]): string {
  return `No reviewer holds the credential "${asked}". Available: ${labels(available)}. Nothing was charged.`;
}

/**
 * The wrong-key-type failure.
 *
 * Refused where the key is loaded rather than at the facilitator, where the
 * same mistake comes back as a bad signature and names nothing useful.
 */
export function wrongKeyTypeReply(accountId: string, keyType: string): string {
  return (
    `Your account ${accountId} uses ${keyType === "ED25519" ? "an ED25519" : `a ${keyType}`} key. ` +
    "The service fee needs an ECDSA account. Nothing was charged."
  );
}

/** The insufficient-balance failure. Both numbers, never their sum. */
export function insufficientBalanceReply(
  balanceTinybars: string,
  feeTinybars: string,
  escrowTinybars: string,
): string {
  return (
    `Your account holds ${hbar(balanceTinybars)}. Posting needs ${hbar(feeTinybars)} for the fee ` +
    `plus ${hbar(escrowTinybars)} for escrow. Nothing was charged.`
  );
}
