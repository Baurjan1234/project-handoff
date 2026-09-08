import { describe, expect, it } from "vitest";
import { Utc } from "@handoff/schema";
import { assertClaimTimeoutConfigValid, ClaimRefusedError, ClaimWindowConfigError, resolveClaimWindow } from "./claim-window.js";

const POSTED = "2026-09-14T00:00:00Z";
const DEADLINE = "2026-09-14T06:00:00Z"; // 6h window

describe("assertClaimTimeoutConfigValid", () => {
  it("accepts a claim-timeout within bounds and within its share of the window", () => {
    expect(() => assertClaimTimeoutConfigValid(POSTED, DEADLINE, 900)).not.toThrow();
  });

  it("rejects a claim-timeout below the absolute minimum", () => {
    expect(() => assertClaimTimeoutConfigValid(POSTED, DEADLINE, 60)).toThrow(ClaimWindowConfigError);
  });

  it("rejects a claim-timeout above the absolute maximum", () => {
    expect(() => assertClaimTimeoutConfigValid(POSTED, DEADLINE, 100_000)).toThrow(ClaimWindowConfigError);
  });

  it("rejects a claim-timeout exceeding its max share of the post-to-deadline window", () => {
    // 6h window, 1/3 share = 2h max; 3h claim-timeout is a lazy-claimant hostage risk.
    expect(() => assertClaimTimeoutConfigValid(POSTED, DEADLINE, 3 * 3600)).toThrow(ClaimWindowConfigError);
  });

  it("rejects a deadline that is not after postedAt", () => {
    expect(() => assertClaimTimeoutConfigValid(DEADLINE, POSTED, 900)).toThrow(ClaimWindowConfigError);
  });
});

describe("resolveClaimWindow", () => {
  it("uses the full claim-timeout when plenty of time remains before the deadline", () => {
    const claimedAt = "2026-09-14T01:00:00Z"; // 5h remain, well over a 900s timeout
    const result = resolveClaimWindow({ postedAt: POSTED, deadline: DEADLINE, claimedAt, claimTimeoutSeconds: 900 });

    expect(result.effectiveWindowSeconds).toBe(900);
    expect(result.signByUtc).toBe("2026-09-14T01:15:00Z");
    expect(() => Utc.parse(result.signByUtc)).not.toThrow();
  });

  it("caps the window at the time remaining to the deadline, not the configured timeout", () => {
    // 10 minutes remain before the deadline; configured timeout is 900s (15min).
    const claimedAt = "2026-09-14T05:50:00Z";
    const result = resolveClaimWindow({ postedAt: POSTED, deadline: DEADLINE, claimedAt, claimTimeoutSeconds: 900 });

    expect(result.effectiveWindowSeconds).toBe(600); // 10 minutes, not 15
    expect(result.signByUtc).toBe(DEADLINE);
  });

  it("refuses the claim outright when the remaining time is below the absolute minimum", () => {
    // 2 minutes remain — below CLAIM_TIMEOUT_MIN_SECONDS (300s) — "too close to the deadline to review".
    const claimedAt = "2026-09-14T05:58:00Z";
    expect(() => resolveClaimWindow({ postedAt: POSTED, deadline: DEADLINE, claimedAt, claimTimeoutSeconds: 900 })).toThrow(
      ClaimRefusedError,
    );
  });

  it("still validates the claim-timeout's own config even at claim time", () => {
    const claimedAt = "2026-09-14T01:00:00Z";
    expect(() =>
      resolveClaimWindow({ postedAt: POSTED, deadline: DEADLINE, claimedAt, claimTimeoutSeconds: 3 * 3600 }),
    ).toThrow(ClaimWindowConfigError);
  });
});
