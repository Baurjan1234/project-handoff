import { describe, expect, it } from "vitest";
import { hbarToTinybars } from "@handoff/schema";
import { fetchHbarRate, formatCents, interpretRate, RateUnavailable, tinybarsToCents, usdWords } from "./usd";

/** The shape from Hedera's own docs: 30000 HBAR = 596987 cents, so ~$0.199 each. */
const body = { current_rate: { cent_equivalent: 596987, expiration_time: 1649689200, hbar_equivalent: 30000 } };
const rate = interpretRate(body);
/** A round rate for arithmetic that is easy to check by hand: 1 HBAR = 4 cents. */
const fourCents = { centEquivalent: 4n, hbarEquivalent: 1n };

describe("interpretRate", () => {
  it("takes the current rate and refuses anything else", () => {
    expect(rate).toEqual({ centEquivalent: 596987n, hbarEquivalent: 30000n });
    expect(() => interpretRate({})).toThrow(RateUnavailable);
    expect(() => interpretRate(null)).toThrow(RateUnavailable);
    expect(() => interpretRate({ current_rate: { cent_equivalent: 0, hbar_equivalent: 30000 } })).toThrow(/cent_equivalent/);
    expect(() => interpretRate({ current_rate: { cent_equivalent: 1.5, hbar_equivalent: 30000 } })).toThrow(/cent_equivalent/);
    expect(() => interpretRate({ current_rate: { cent_equivalent: 1, hbar_equivalent: "30000" } })).toThrow(/hbar_equivalent/);
  });
});

describe("tinybarsToCents", () => {
  it("is the documented arithmetic: cents per HBAR is cent_equivalent over hbar_equivalent", () => {
    expect(tinybarsToCents(hbarToTinybars("100"), fourCents)).toBe(400n);
    expect(usdWords(hbarToTinybars("100"), fourCents)).toBe("$4.00");
    expect(usdWords(hbarToTinybars("0.5"), fourCents)).toBe("$0.02");
    // 100 HBAR at Hedera's documented rate: 100 * 596987 / 30000 cents.
    expect(usdWords(hbarToTinybars("100"), rate)).toBe("$19.90");
  });

  it("rounds to the nearest cent, half up, and keeps a sign", () => {
    // 1 HBAR at 2.5 cents rounds up; the negative leg of a transfer keeps its sign.
    const halfCent = { centEquivalent: 25n, hbarEquivalent: 10n };
    expect(tinybarsToCents(hbarToTinybars("1"), halfCent)).toBe(3n);
    expect(tinybarsToCents(-hbarToTinybars("1"), halfCent)).toBe(-3n);
    expect(formatCents(-400n)).toBe("-$4.00");
  });

  it("stays exact where a float would not, at amounts no demo will reach", () => {
    const huge = hbarToTinybars("50000000000");
    expect(tinybarsToCents(huge, fourCents)).toBe(200_000_000_000n);
    expect(usdWords(huge, fourCents)).toBe("$2000000000.00");
  });
});

describe("fetchHbarRate", () => {
  it("reads the network's rate from the mirror node", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      seen.push(String(input));
      return new Response(JSON.stringify(body), { status: 200 });
    };
    expect(await fetchHbarRate("https://testnet.mirrornode.hedera.com/api/v1/", fetchImpl)).toEqual(rate);
    expect(seen[0]).toBe("https://testnet.mirrornode.hedera.com/api/v1/network/exchangerate");
  });

  it("says the rate is unavailable rather than guessing one", async () => {
    const down: typeof fetch = async () => new Response(null, { status: 503 });
    await expect(fetchHbarRate("https://mirror.example/api/v1", down)).rejects.toThrow(/503/);
  });
});
