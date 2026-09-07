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
}

/**
 * Beat 3, with the beat-2 fee proof row above it.
 *
 * The fee row comes first and smaller, the escrow line second and heavier,
 * because a requester who has just watched two numbers move needs to see which
 * one was spent and which one is being held.
 */
export function postedReply(reply: PostedReply): string {
  const fee =
    reply.feeTinybars === undefined
      ? `Service fee not settled · ${reply.feeError ?? "the facilitator did not confirm it"}`
      : `Service fee settled · ${hbar(reply.feeTinybars)}`;

  return [
    fee,
    "",
    `Order posted · #${reply.orderId}`,
    `${hbar(reply.priceTinybars)} locked in escrow for the review.`,
    "It pays the reviewer when they sign, whatever the verdict. " +
      `If nobody claims it by ${clockTime(reply.deadline)}, it returns to you.`,
    `Visible to reviewers holding: ${reply.certTagLabel}. Cannot be cancelled once posted.`,
  ].join("\n");
}

/** Beats 4–9, the wait. One answer, not a loop. */
export function waitingReply(deadline: string): string {
  return `Posted · waiting for a certified reviewer. Open until ${clockTime(deadline)}.`;
}

/**
 * What we can say while no claim message shape exists.
 *
 * The design system's claimed line names the claimant's account and their sign
 * deadline, and neither is readable today: there is a `CLAIM` lifecycle event
 * but nothing on a topic to read it from. Saying so in one line is the design
 * system's own instruction for something that cannot be delivered this week —
 * better than a requester reading "waiting" and concluding nobody has taken
 * their order.
 */
export const CLAIM_NOT_READABLE =
  "Whether a reviewer has claimed it is not readable yet — claims are not " +
  "published to a topic in this build. The signed verdict appears here when it lands.";

export interface DeliveredReply {
  readonly verdict: string;
  readonly signedBy: string;
}

/**
 * The close, in the form status can honestly carry today.
 *
 * The full beat-10 close — defect codes inline, the reviewer's notes from the
 * content store, the money line — is NAS-37. This says the judgment exists and
 * who signed it, and points at the rest rather than pretending it is here.
 */
export function deliveredReply(reply: DeliveredReply): string {
  return [
    `Verdict: ${reply.verdict}`,
    `Signed by a certified reviewer, account ${reply.signedBy} · Published forever`,
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
