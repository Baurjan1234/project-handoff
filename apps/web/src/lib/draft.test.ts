import { describe, expect, it } from "vitest";
import { draftStore, EMPTY_DRAFT, parseDraft } from "./draft";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe("drafts", () => {
  it("survive a reload and are cleared once signed", () => {
    const storage = memoryStorage();
    const store = draftStore(() => storage);
    store.save("ord", { notes: "n", issues: ["Missing receipt"], verdict: "reject", step: "sign" });
    expect(store.load("ord")).toEqual({ notes: "n", issues: ["Missing receipt"], verdict: "reject", step: "sign" });
    store.clear("ord");
    expect(store.load("ord")).toEqual(EMPTY_DRAFT);
  });

  it("renders with no draft when storage is missing or refuses", () => {
    expect(draftStore(() => undefined).load("ord")).toEqual(EMPTY_DRAFT);
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const store = draftStore(() => throwing);
    expect(store.load("ord")).toEqual(EMPTY_DRAFT);
    expect(() => store.save("ord", EMPTY_DRAFT)).not.toThrow();
    expect(() => store.clear("ord")).not.toThrow();
  });

  it("takes only a shape it wrote", () => {
    expect(parseDraft({ notes: 1, issues: ["A", 2], verdict: "maybe", step: "elsewhere" })).toEqual({
      notes: "",
      issues: ["A"],
      verdict: null,
      step: "notes",
    });
    // A draft written before issues carried their sentence still opens.
    expect(parseDraft({ notes: "n", defects: ["FN-2-DATE"] })).toEqual({
      notes: "n",
      issues: ["FN-2-DATE"],
      verdict: null,
      step: "notes",
    });
    expect(parseDraft("nope")).toEqual(EMPTY_DRAFT);
  });
});
