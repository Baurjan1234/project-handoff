import { describe, expect, it } from "vitest";
import { claimRefusal, claimWindowWords, clockWords, epochSecondsToUtc, isPast, signBy } from "./clock";

// All in local time of the test machine, so the fixtures are built from Date.
function utcOf(local: Date): string {
  return local.toISOString().replace(/\.\d{3}Z$/, "Z");
}

describe("clockWords", () => {
  const now = new Date(2026, 8, 8, 17, 30, 0); // Tue Sep 8 2026 17:30 local

  it("is a time, never a countdown", () => {
    const at = new Date(2026, 8, 8, 18, 12, 0);
    expect(clockWords(utcOf(at), now)).toBe("18:12");
    expect(clockWords(utcOf(at), now)).not.toMatch(/min|left|remaining/);
  });

  it("names tomorrow, then the weekday, then the date", () => {
    expect(clockWords(utcOf(new Date(2026, 8, 9, 9, 5, 0)), now)).toBe("tomorrow 09:05");
    expect(clockWords(utcOf(new Date(2026, 8, 11, 11, 59, 0)), now)).toBe("Fri 11:59");
    expect(clockWords(utcOf(new Date(2026, 8, 20, 0, 0, 0)), now)).toBe("Sep 20, 00:00");
  });

  it("gives a past instant its date rather than a weekday that reads as next week", () => {
    expect(clockWords(utcOf(new Date(2026, 8, 1, 10, 0, 0)), now)).toBe("Sep 1, 10:00");
  });
});

describe("claimWindowWords", () => {
  it("speaks minutes under an hour and hours above", () => {
    expect(claimWindowWords(1800)).toBe("30 min to sign after you claim");
    expect(claimWindowWords(3600)).toBe("1 h to sign after you claim");
    expect(claimWindowWords(5400)).toBe("1.5 h to sign after you claim");
  });
});

describe("signBy", () => {
  const deadline = "2026-09-14T00:00:00Z";
  const deadlineSeconds = Date.UTC(2026, 8, 14) / 1000;

  it("is the claim timeout after the claim", () => {
    const claimedAt = deadlineSeconds - 7200;
    expect(signBy(claimedAt, 1800, deadline)).toBe(epochSecondsToUtc(claimedAt + 1800));
  });

  it("never extends past the order deadline", () => {
    const claimedAt = deadlineSeconds - 600;
    expect(signBy(claimedAt, 1800, deadline)).toBe(deadline);
  });
});

describe("claimRefusal", () => {
  const deadline = "2026-09-14T00:00:00Z";
  const deadlineSeconds = Date.UTC(2026, 8, 14) / 1000;

  it("offers Claim when there is time to review", () => {
    expect(claimRefusal(deadline, deadlineSeconds - 3600)).toBeNull();
  });

  it("refuses when the remaining window is too short to review", () => {
    expect(claimRefusal(deadline, deadlineSeconds - 300)).toBe("Too close to the deadline to review.");
  });

  it("says the deadline passed once it has", () => {
    expect(claimRefusal(deadline, deadlineSeconds)).toBe("Deadline passed · funds returned to the requester");
    expect(isPast(deadline, deadlineSeconds)).toBe(true);
    expect(isPast(deadline, deadlineSeconds - 1)).toBe(false);
  });
});
