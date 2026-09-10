/**
 * Issues: what the expert writes, and what actually gets published.
 *
 * The expert writes a sentence per issue. Two different things come out of
 * it, and keeping them apart is the whole point of this file:
 *
 * - **The code goes on-chain.** `D-001`, `D-002`, numbered by position, one
 *   per issue. Short structured codes are what `defects[]` is for, and the
 *   schema's bounds still decide how many there may be. Renumbering by
 *   position means the codes are always contiguous, so removing the first
 *   issue cannot leave a gap or a duplicate.
 * - **The sentence goes in the notes**, which are stored off-chain and
 *   delivered to the requester. `composeNotes` is the one place the two are
 *   joined, so the text the expert sees, the fingerprint on screen and the
 *   bytes in the content store are the same thing by construction.
 *
 * A code without its sentence is unreadable, which is why the sentence
 * cannot be optional and why it travels with the notes rather than being
 * dropped. Postel's law for the field a person types: trim it and collapse
 * runs of whitespace rather than rejecting it.
 */

import { DEFECTS_MAX_ITEMS } from "@handoff/schema";

/** Long enough for a sentence, short enough to stay a label. Characters, not bytes. */
export const ISSUE_TEXT_MAX_CHARS = 120;

export { DEFECTS_MAX_ITEMS };

export function normalizeIssue(input: string): string {
  return input.trim().replace(/\s+/g, " ").slice(0, ISSUE_TEXT_MAX_CHARS);
}

/** The published code for the issue at this position. One-based, zero-padded. */
export function issueCode(index: number): string {
  return `D-${String(index + 1).padStart(3, "0")}`;
}

/** What goes in `defects[]`: one short code per issue, in order. */
export function issueCodes(issues: readonly string[]): readonly string[] {
  return issues.map((_, index) => issueCode(index));
}

export interface IssueBudget {
  readonly listed: number;
  readonly maxItems: number;
  readonly full: boolean;
  /** Characters left in the sentence being typed. Negative when over. */
  readonly charactersLeft: number;
  readonly over: boolean;
}

export function issueBudget(issues: readonly string[], draft: string): IssueBudget {
  const used = draft.trim().length;
  return {
    listed: issues.length,
    maxItems: DEFECTS_MAX_ITEMS,
    full: issues.length >= DEFECTS_MAX_ITEMS,
    charactersLeft: ISSUE_TEXT_MAX_CHARS - used,
    over: used > ISSUE_TEXT_MAX_CHARS,
  };
}

/** "2 of 8 issues" */
export function issueCountWords(budget: IssueBudget): string {
  return `${budget.listed} of ${budget.maxItems} ${budget.listed === 1 ? "issue" : "issues"}`;
}

/**
 * The notes as they are stored, hashed and delivered: what the expert wrote,
 * then the issues under their codes. One function, so the fingerprint on
 * screen is the fingerprint of the bytes that get published.
 */
export function composeNotes(notes: string, issues: readonly string[]): string {
  const written = notes.trim();
  if (issues.length === 0) return written;
  const listed = issues.map((text, index) => `${issueCode(index)} ${normalizeIssue(text)}`).join("\n");
  return written === "" ? `Issues\n${listed}` : `${written}\n\nIssues\n${listed}`;
}
