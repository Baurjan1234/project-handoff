import { describe, expect, it } from "vitest";
import {
  assertInRange,
  assertPositive,
  formatTinybars,
  hbarToTinybars,
  MAX_TINYBARS,
  MIN_TINYBARS,
  MoneyError,
  parseTinybars,
  TINYBARS_PER_HBAR,
  tinybarsToDisplay,
  tinybarsToHbar,
} from "./money.js";

describe("hbarToTinybars", () => {
  it("converts whole HBAR", () => {
    expect(hbarToTinybars("200")).toBe(20_000_000_000n);
    expect(hbarToTinybars("1")).toBe(TINYBARS_PER_HBAR);
    expect(hbarToTinybars("0")).toBe(0n);
  });

  it("converts the smallest unit", () => {
    expect(hbarToTinybars("0.00000001")).toBe(1n);
    expect(hbarToTinybars("1.00000001")).toBe(100_000_001n);
  });

  it("pads short fractions rather than misreading them", () => {
    expect(hbarToTinybars("0.1")).toBe(10_000_000n);
    expect(hbarToTinybars("0.01")).toBe(1_000_000n);
  });

  it("handles negatives", () => {
    expect(hbarToTinybars("-1.5")).toBe(-150_000_000n);
  });

  it("refuses sub-tinybar precision instead of rounding it away", () => {
    expect(() => hbarToTinybars("0.000000001")).toThrow(MoneyError);
    expect(() => hbarToTinybars("1.123456789")).toThrow(MoneyError);
  });

  it.each([
    "1e5",
    "1,000",
    " 1",
    "1 ",
    "",
    "01",
    "1.",
    ".1",
    "+1",
    "Infinity",
    "NaN",
    "0x10",
    "--1",
    "1.2.3",
  ])("rejects %o", (bad) => {
    expect(() => hbarToTinybars(bad)).toThrow(MoneyError);
  });

  it("rejects a non-string even when the caller lies about the type", () => {
    expect(() => hbarToTinybars(200 as unknown as string)).toThrow(MoneyError);
  });
});

describe("tinybarsToHbar", () => {
  it("renders whole amounts without a decimal point", () => {
    expect(tinybarsToHbar(20_000_000_000n)).toBe("200");
    expect(tinybarsToHbar(0n)).toBe("0");
  });

  it("renders the smallest unit with all eight places", () => {
    expect(tinybarsToHbar(1n)).toBe("0.00000001");
  });

  it("trims trailing zeros but never significant digits", () => {
    expect(tinybarsToHbar(10_000_000n)).toBe("0.1");
    expect(tinybarsToHbar(100_000_001n)).toBe("1.00000001");
  });

  it("renders negatives", () => {
    expect(tinybarsToHbar(-150_000_000n)).toBe("-1.5");
  });
});

describe("round trips", () => {
  it.each([
    "0",
    "1",
    "200",
    "0.00000001",
    "1.00000001",
    "0.1",
    "-1.5",
    "92233720368.54775807",
  ])("survives %o unchanged", (hbar) => {
    expect(tinybarsToHbar(hbarToTinybars(hbar))).toBe(hbar);
  });

  it("survives the wire form unchanged", () => {
    for (const t of [0n, 1n, -1n, 20_000_000_000n, MAX_TINYBARS, MIN_TINYBARS]) {
      expect(parseTinybars(formatTinybars(t))).toBe(t);
    }
  });
});

describe("int64 bounds", () => {
  it("accepts the extremes", () => {
    expect(assertInRange(MAX_TINYBARS)).toBe(MAX_TINYBARS);
    expect(assertInRange(MIN_TINYBARS)).toBe(MIN_TINYBARS);
  });

  it("rejects one past either end", () => {
    expect(() => assertInRange(MAX_TINYBARS + 1n)).toThrow(MoneyError);
    expect(() => assertInRange(MIN_TINYBARS - 1n)).toThrow(MoneyError);
  });

  it("rejects an HBAR string that overflows int64", () => {
    expect(() => hbarToTinybars("92233720369")).toThrow(MoneyError);
  });
});

describe("parseTinybars", () => {
  it.each(["1.0", "0.5", "1e5", "", " 7", "007", "+7"])("rejects %o", (bad) => {
    expect(() => parseTinybars(bad)).toThrow(MoneyError);
  });

  it("accepts a signed integer string", () => {
    expect(parseTinybars("-42")).toBe(-42n);
  });
});

describe("assertPositive", () => {
  it("rejects zero, because zero is not a price", () => {
    expect(() => assertPositive(0n)).toThrow(MoneyError);
    expect(() => assertPositive(-1n)).toThrow(MoneyError);
    expect(assertPositive(1n)).toBe(1n);
  });
});

describe("tinybarsToDisplay", () => {
  it("is for screens only", () => {
    expect(tinybarsToDisplay(20_000_000_000n)).toBe("200 HBAR");
  });
});
