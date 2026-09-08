import { describe, expect, it } from "vitest";
import { DEFECT_CODE_MAX_BYTES, DEFECTS_MAX_ITEMS, DefectCode } from "@handoff/schema";
import { budgetWords, defectBudget, normalizeDefectCode } from "./defects";

describe("normalizeDefectCode", () => {
  it("uppercases, trims and collapses spaces instead of rejecting", () => {
    expect(normalizeDefectCode("  no   monitoring ")).toBe("NO_MONITORING");
    expect(normalizeDefectCode("fn-2-date")).toBe("FN-2-DATE");
    expect(normalizeDefectCode("NO_MONITORING")).toBe("NO_MONITORING");
  });

  it("produces a code the verifier accepts", () => {
    expect(DefectCode.safeParse(normalizeDefectCode(" missing sig ")).success).toBe(true);
  });
});

describe("defectBudget", () => {
  it("counts in characters, from the schema's bound, never a number of its own", () => {
    const budget = defectBudget(["A", "B"], "NO_MONITORING");
    expect(budget.maxItems).toBe(DEFECTS_MAX_ITEMS);
    expect(budget.charactersLeft).toBe(DEFECT_CODE_MAX_BYTES - "NO_MONITORING".length);
    expect(budgetWords(budget)).toBe(`2 of ${DEFECTS_MAX_ITEMS} · ${DEFECT_CODE_MAX_BYTES - 13} characters left`);
    expect(budgetWords(budget)).not.toContain("byte");
  });

  it("charges an accented letter what HCS charges it, so the count never overpromises", () => {
    const budget = defectBudget([], "É");
    expect(budget.charactersLeft).toBe(DEFECT_CODE_MAX_BYTES - 2);
  });

  it("says over budget with the instruction, not a code", () => {
    const budget = defectBudget([], "X".repeat(DEFECT_CODE_MAX_BYTES + 3));
    expect(budget.over).toBe(true);
    expect(budgetWords(budget)).toContain("3 over · shorten this defect code");
  });

  it("knows when the list is full", () => {
    expect(defectBudget(Array.from({ length: DEFECTS_MAX_ITEMS }, (_, i) => `D${i}`), "").full).toBe(true);
  });
});
