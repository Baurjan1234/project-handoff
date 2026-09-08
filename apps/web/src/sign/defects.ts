/**
 * Defect codes as typed, made into defect codes as published.
 *
 * Postel's law for the one field the expert types by hand: normalize rather
 * than reject. Uppercase, trimmed, whitespace collapsed into the underscore
 * the placeholder already suggests, so "no monitoring " and "NO_MONITORING"
 * are the same code and neither gets bounced.
 *
 * The budget is the schema's, in bytes, because HCS limits bytes. The screen
 * says "characters" because that is the word a person counts in, and for the
 * uppercase ASCII codes this convention produces the two are the same number.
 * When they differ (an accented letter costs two), the bytes are what is
 * enforced and the count shown is what is left, so the number on screen
 * never promises room that is not there.
 */

import { byteLength, DEFECT_CODE_MAX_BYTES, DEFECTS_MAX_ITEMS } from "@handoff/schema";

export function normalizeDefectCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "_");
}

export interface DefectBudget {
  readonly listed: number;
  readonly maxItems: number;
  /** Budget left for the code being typed, in the unit the screen names. Negative when over. */
  readonly charactersLeft: number;
  readonly over: boolean;
  readonly full: boolean;
}

export function defectBudget(defects: readonly string[], draft: string): DefectBudget {
  const used = byteLength(normalizeDefectCode(draft));
  return {
    listed: defects.length,
    maxItems: DEFECTS_MAX_ITEMS,
    charactersLeft: DEFECT_CODE_MAX_BYTES - used,
    over: used > DEFECT_CODE_MAX_BYTES,
    full: defects.length >= DEFECTS_MAX_ITEMS,
  };
}

/** "2 of 8 · 35 characters left" */
export function budgetWords(budget: DefectBudget): string {
  const left =
    budget.charactersLeft < 0
      ? `${-budget.charactersLeft} over · shorten this defect code`
      : `${budget.charactersLeft} characters left`;
  return `${budget.listed} of ${budget.maxItems} · ${left}`;
}
