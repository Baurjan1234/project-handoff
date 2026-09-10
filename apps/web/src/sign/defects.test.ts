import { describe, expect, it } from "vitest";
import { DEFECTS_MAX_ITEMS } from "@handoff/schema";
import {
  composeNotes,
  issueBudget,
  issueCode,
  issueCodes,
  issueCountWords,
  ISSUE_TEXT_MAX_CHARS,
  normalizeIssue,
} from "./defects";

describe("issueCode", () => {
  it("numbers by position, so codes are contiguous whatever is removed", () => {
    expect(issueCode(0)).toBe("D-001");
    expect(issueCode(9)).toBe("D-010");
    expect(issueCodes(["a", "b", "c"])).toEqual(["D-001", "D-002", "D-003"]);
    // Remove the first: the rest renumber rather than leaving a gap.
    expect(issueCodes(["b", "c"])).toEqual(["D-001", "D-002"]);
  });

  it("produces codes the verifier accepts, well inside the schema's bound", async () => {
    const { DefectCode } = await import("@handoff/schema");
    expect(DefectCode.safeParse(issueCode(0)).success).toBe(true);
    expect(issueCodes(Array.from({ length: DEFECTS_MAX_ITEMS }, (_, i) => `issue ${i}`))).toHaveLength(DEFECTS_MAX_ITEMS);
  });
});

describe("normalizeIssue", () => {
  it("trims and collapses instead of rejecting, and never exceeds the cap", () => {
    expect(normalizeIssue("  Missing   receipt  ")).toBe("Missing receipt");
    expect(normalizeIssue("x".repeat(ISSUE_TEXT_MAX_CHARS + 20))).toHaveLength(ISSUE_TEXT_MAX_CHARS);
  });
});

describe("issueBudget", () => {
  it("counts issues against the schema's bound and characters against the sentence cap", () => {
    const budget = issueBudget(["one", "two"], "Missing receipt");
    expect(budget.maxItems).toBe(DEFECTS_MAX_ITEMS);
    expect(budget.charactersLeft).toBe(ISSUE_TEXT_MAX_CHARS - "Missing receipt".length);
    expect(issueCountWords(budget)).toBe(`2 of ${DEFECTS_MAX_ITEMS} issues`);
    expect(issueCountWords(issueBudget(["one"], ""))).toBe(`1 of ${DEFECTS_MAX_ITEMS} issue`);
    expect(issueBudget(Array.from({ length: DEFECTS_MAX_ITEMS }, () => "x"), "").full).toBe(true);
    expect(issueBudget([], "x".repeat(ISSUE_TEXT_MAX_CHARS + 1)).over).toBe(true);
  });
});

describe("composeNotes", () => {
  it("is what gets stored, hashed and delivered: the writing, then the issues under their codes", () => {
    expect(composeNotes("Footnote 2 dates the filing early.", ["Missing receipt", "Over policy limit"])).toBe(
      "Footnote 2 dates the filing early.\n\nIssues\nD-001 Missing receipt\nD-002 Over policy limit",
    );
  });

  it("is the writing alone when there are no issues", () => {
    expect(composeNotes("  All figures foot.  ", [])).toBe("All figures foot.");
  });

  it("still delivers the issues when the expert wrote nothing else", () => {
    expect(composeNotes("", ["Missing receipt"])).toBe("Issues\nD-001 Missing receipt");
  });

  it("carries the sentence the code alone could not, so a code is never orphaned", () => {
    const composed = composeNotes("Checked all 23.", ["Missing receipt — R. Chen equipment claim"]);
    for (const code of issueCodes(["one"])) expect(composed).toContain(code);
    expect(composed).toContain("R. Chen equipment claim");
  });
});
