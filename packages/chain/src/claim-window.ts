/**
 * The claim window, reconciling the two clocks a claim always has: the order's own
 * claim-timeout, and the time remaining before the order deadline. Per
 * docs/decisions (NAS-39, persona review): "the claim window is min(claim timeout,
 * time remaining to the deadline). If the remaining window is too short to review,
 * Claim is refused." This is what lets the expert app show one honest time —
 * "Sign by 18:12" — instead of two clocks that can disagree.
 *
 * Pure, no SDK calls — same reasoning as lifecycle.ts.
 */

import { CLAIM_TIMEOUT_MAX_SECONDS, CLAIM_TIMEOUT_MAX_SHARE_OF_WINDOW, CLAIM_TIMEOUT_MIN_SECONDS, utcToEpochSeconds } from "@handoff/schema";

export class ClaimWindowConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaimWindowConfigError";
  }
}

/** Thrown when the deadline is too close for a claim to be worth accepting at all. */
export class ClaimRefusedError extends Error {
  constructor() {
    super("Too close to the deadline to review");
    this.name = "ClaimRefusedError";
  }
}

export interface ClaimWindowParams {
  /** UTC instant the order was posted — used to validate the timeout's share of the window. */
  postedAt: string;
  /** UTC instant the order expires if unclaimed. */
  deadline: string;
  /** UTC instant (typically the claim's consensus timestamp) the claim happened at. */
  claimedAt: string;
  /** The order's configured claim-timeout, in seconds — must already respect the schema bounds. */
  claimTimeoutSeconds: number;
}

export interface ClaimWindow {
  /** min(claimTimeoutSeconds, time remaining to deadline) — the one number the UI shows. */
  effectiveWindowSeconds: number;
  signByEpochSeconds: number;
  /** UTC instant, same format as every other timestamp in this codebase. */
  signByUtc: string;
}

function epochSecondsToUtc(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Validates a claim-timeout value against the schema's absolute bounds and its
 * share of the post-to-deadline window — call this when an order is POSTED, not
 * per-claim, since it doesn't depend on when the claim happens.
 */
export function assertClaimTimeoutConfigValid(postedAt: string, deadline: string, claimTimeoutSeconds: number): void {
  if (claimTimeoutSeconds < CLAIM_TIMEOUT_MIN_SECONDS || claimTimeoutSeconds > CLAIM_TIMEOUT_MAX_SECONDS) {
    throw new ClaimWindowConfigError(
      `claim-timeout ${claimTimeoutSeconds}s is outside [${CLAIM_TIMEOUT_MIN_SECONDS}, ${CLAIM_TIMEOUT_MAX_SECONDS}]s`,
    );
  }

  const totalWindowSeconds = utcToEpochSeconds(deadline) - utcToEpochSeconds(postedAt);
  if (totalWindowSeconds <= 0) {
    throw new ClaimWindowConfigError(`deadline ${deadline} is not after postedAt ${postedAt}`);
  }

  const maxAllowed = totalWindowSeconds * CLAIM_TIMEOUT_MAX_SHARE_OF_WINDOW;
  if (claimTimeoutSeconds > maxAllowed) {
    throw new ClaimWindowConfigError(
      `claim-timeout ${claimTimeoutSeconds}s exceeds ${CLAIM_TIMEOUT_MAX_SHARE_OF_WINDOW} of the ${totalWindowSeconds}s post-to-deadline window (max ${maxAllowed}s) — a lazy claimant could hold funds hostage to the deadline`,
    );
  }
}

/**
 * Resolves the actual claim window at the moment of a specific claim. Throws
 * ClaimRefusedError if the deadline is too close to leave any real review time —
 * the caller (whatever accepts the claim) must refuse the claim outright in that
 * case, not accept it with a near-zero window.
 */
export function resolveClaimWindow(params: ClaimWindowParams): ClaimWindow {
  assertClaimTimeoutConfigValid(params.postedAt, params.deadline, params.claimTimeoutSeconds);

  const claimedAtEpoch = utcToEpochSeconds(params.claimedAt);
  const deadlineEpoch = utcToEpochSeconds(params.deadline);
  const remainingSeconds = deadlineEpoch - claimedAtEpoch;

  if (remainingSeconds < CLAIM_TIMEOUT_MIN_SECONDS) {
    throw new ClaimRefusedError();
  }

  const effectiveWindowSeconds = Math.min(params.claimTimeoutSeconds, remainingSeconds);
  const signByEpochSeconds = claimedAtEpoch + effectiveWindowSeconds;

  return {
    effectiveWindowSeconds,
    signByEpochSeconds,
    signByUtc: epochSecondsToUtc(signByEpochSeconds),
  };
}
