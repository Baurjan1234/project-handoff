import { describe, expect, it } from "vitest";
import { decodeTags, fetchCertTags } from "./tags";

/** The live answer, verbatim, from `GET /tags` on 2026-09-10. */
const LIVE = { tags: [{ code: "cpa-us", label: "Licensed reviewer" }] };

describe("who may review", () => {
  it("reads the live list", () => {
    expect(decodeTags(LIVE)).toEqual([{ code: "cpa-us", label: "Licensed reviewer" }]);
  });

  it("falls back to the code when there is no label to show", () => {
    expect(decodeTags({ tags: [{ code: "cpa-us" }] })).toEqual([{ code: "cpa-us", label: "cpa-us" }]);
  });

  it("drops a row with no code, which could not route an order anyway", () => {
    expect(decodeTags({ tags: [{ label: "Nameless" }, { code: "", label: "Empty" }, 7, null] })).toEqual([]);
  });

  it("answers an empty list rather than throwing on nonsense", () => {
    expect(decodeTags(null)).toEqual([]);
    expect(decodeTags({ tags: "cpa-us" })).toEqual([]);
    expect(decodeTags({})).toEqual([]);
  });

  it("answers an empty list when the service refuses", async () => {
    const refused: typeof fetch = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    expect(await fetchCertTags({ apiUrl: "https://api.example", fetchImpl: refused })).toEqual([]);
  });

  it("asks the right URL", async () => {
    const seen: string[] = [];
    const spy: typeof fetch = (async (url: string) => {
      seen.push(url);
      return new Response(JSON.stringify(LIVE), { status: 200 });
    }) as unknown as typeof fetch;
    await fetchCertTags({ apiUrl: "https://api.example/", fetchImpl: spy });
    expect(seen[0]).toBe("https://api.example/tags");
  });
});
