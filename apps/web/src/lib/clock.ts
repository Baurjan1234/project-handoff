/**
 * Clocks are times, never countdowns.
 *
 * "Sign by 18:12" is a fact the expert can put in their calendar. "27 min
 * left" is trading-terminal energy and goes stale the moment it is painted.
 * Every deadline the app shows goes through `clockWords`, so a countdown
 * cannot creep in one screen at a time.
 *
 * The other rule here is the lifecycle one settled on 2026-09-06: the claim
 * window never extends past the order deadline. `signBy` takes the earlier of
 * the two, and `claimRefusal` says when the remaining window is too short to
 * review at all, so the screen shows one honest time rather than two clocks
 * that never reconcile.
 */

import { utcToEpochSeconds } from "@handoff/schema";

/** Below this many seconds left, Claim is refused. Reviewing takes longer than this. */
export const MIN_REVIEW_WINDOW_SECONDS = 10 * 60;

const DAY_MS = 24 * 3600 * 1000;

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function hhmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * A UTC instant as the expert's local clock reads it. Today: "18:12".
 * Tomorrow: "tomorrow 18:12". Within the week: "Thu 18:12". Further out the
 * date comes along, because "18:12" alone would be a lie about which day.
 */
export function clockWords(utc: string, now: Date): string {
  const at = new Date(utcToEpochSeconds(utc) * 1000);
  const time = hhmm(at);
  if (sameLocalDay(at, now)) return time;
  if (sameLocalDay(at, new Date(now.getTime() + DAY_MS))) return `tomorrow ${time}`;
  const ahead = at.getTime() - now.getTime();
  if (ahead > 0 && ahead < 6 * DAY_MS) return `${WEEKDAYS[at.getDay()]} ${time}`;
  return `${MONTHS[at.getMonth()]} ${at.getDate()}, ${time}`;
}

/** The claim window in words for the inbox row: "30 min to sign after you claim". */
export function claimWindowWords(claimTimeoutSeconds: number): string {
  const minutes = Math.round(claimTimeoutSeconds / 60);
  if (minutes < 60) return `${minutes} min to sign after you claim`;
  const hours = minutes / 60;
  const whole = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  return `${whole} h to sign after you claim`;
}

/** Seconds → the schema's `Utc` shape: second precision, `Z` only. */
export function epochSecondsToUtc(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * When a claim made at `claimedAtEpochSeconds` must be signed by. Never past
 * the order deadline: the earlier of the two wins.
 */
export function signBy(
  claimedAtEpochSeconds: number,
  claimTimeoutSeconds: number,
  deadlineUtc: string,
): string {
  const byTimeout = claimedAtEpochSeconds + claimTimeoutSeconds;
  const deadline = utcToEpochSeconds(deadlineUtc);
  return epochSecondsToUtc(Math.min(byTimeout, deadline));
}

/**
 * Why Claim is refused right now, or null when it may be offered. Two
 * reasons, in the words the screen uses.
 */
export function claimRefusal(deadlineUtc: string, nowEpochSeconds: number): string | null {
  const left = utcToEpochSeconds(deadlineUtc) - nowEpochSeconds;
  if (left <= 0) return "Deadline passed · funds returned to the requester";
  if (left < MIN_REVIEW_WINDOW_SECONDS) return "Too close to the deadline to review.";
  return null;
}

/** True once the instant is behind us. */
export function isPast(utc: string, nowEpochSeconds: number): boolean {
  return utcToEpochSeconds(utc) <= nowEpochSeconds;
}
