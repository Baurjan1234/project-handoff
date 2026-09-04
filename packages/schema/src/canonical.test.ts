import { describe, expect, it } from "vitest";
import {
  byteLength,
  CanonicalizeError,
  canonicalize,
  hashCanonical,
  sha256Hex,
} from "./canonical.js";

describe("canonicalize", () => {
  it("sorts object keys, so insertion order cannot change the hash", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ a: 2, b: 1 })).toBe(canonicalize({ b: 1, a: 2 }));
  });

  it("sorts nested keys too", () => {
    expect(canonicalize({ z: { y: 1, x: 2 }, a: 3 })).toBe('{"a":3,"z":{"x":2,"y":1}}');
  });

  it("preserves array order, which is meaningful", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalize([1, 2, 3])).not.toBe(canonicalize([3, 2, 1]));
  });

  it("emits no whitespace", () => {
    expect(canonicalize({ a: [1, { b: 2 }] })).toBe('{"a":[1,{"b":2}]}');
  });

  it("handles the empty cases", () => {
    expect(canonicalize({})).toBe("{}");
    expect(canonicalize([])).toBe("[]");
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize("")).toBe('""');
  });

  it("escapes strings stably", () => {
    expect(canonicalize({ a: 'he said "hi"' })).toBe('{"a":"he said \\"hi\\""}');
    expect(canonicalize("é")).toBe('"é"');
    expect(canonicalize("line\nbreak")).toBe('"line\\nbreak"');
  });

  it("sorts by code unit, not by locale", () => {
    expect(canonicalize({ Z: 1, a: 2 })).toBe('{"Z":1,"a":2}');
  });
});

describe("canonicalize rejects the ambiguous", () => {
  it("refuses fractional numbers, which is why money is a string", () => {
    expect(() => canonicalize({ price: 0.1 })).toThrow(CanonicalizeError);
    expect(() => canonicalize(1.5)).toThrow(CanonicalizeError);
  });

  it("refuses non-finite numbers", () => {
    expect(() => canonicalize(Number.NaN)).toThrow(CanonicalizeError);
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(CanonicalizeError);
  });

  it("refuses integers beyond safe range", () => {
    expect(() => canonicalize(Number.MAX_SAFE_INTEGER + 2)).toThrow(CanonicalizeError);
  });

  it("refuses a bigint, pointing at the money module", () => {
    expect(() => canonicalize({ amount: 1n })).toThrow(/money module/);
  });

  it("refuses undefined rather than dropping the key silently", () => {
    expect(() => canonicalize({ a: undefined })).toThrow(CanonicalizeError);
    expect(() => canonicalize(undefined)).toThrow(CanonicalizeError);
  });

  it("refuses exotic objects that JSON.stringify would quietly mangle", () => {
    expect(() => canonicalize(new Date(0))).toThrow(CanonicalizeError);
    expect(() => canonicalize(new Map())).toThrow(CanonicalizeError);
    expect(() => canonicalize({ fn: () => 1 })).toThrow(CanonicalizeError);
  });

  it("names the path so a failure deep in an envelope is findable", () => {
    expect(() => canonicalize({ order: { defects: [1.5] } })).toThrow(/\$\.order\.defects\[0\]/);
  });
});

describe("agreement with RFC 8785", () => {
  // Every other test here checks that our canonicalization agrees with itself,
  // which proves nothing about a second implementation producing the same hash.
  // This one checks it against the published JSON Canonicalization Scheme
  // example, which is the only external evidence we have that a verifier
  // written by someone else would compute the same commitment.
  it("reproduces the published example byte for byte", () => {
    const input = {
      "\u20ac": "Euro Sign",
      "\r": "Carriage Return",
      "\ufb33": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "\ud83d\ude00": "Emoji: Grinning Face",
      "\u0080": "Control",
      "\u00e4": "Latin Small Letter A With Diaeresis",
    };

    expect(canonicalize(input)).toBe(
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control","\u00e4":"Latin Small Letter A With Diaeresis",' +
        '"\u20ac":"Euro Sign","\ud83d\ude00":"Emoji: Grinning Face","\ufb33":"Hebrew Letter Dalet With Dagesh"}',
    );
  });

  it("sorts by UTF-16 code unit, which puts the emoji before U+FB33", () => {
    // A code-point sort would order these differently. The surrogate pair's
    // first unit is D83D, which is below FB33.
    expect(canonicalize({ "\ufb33": 1, "\ud83d\ude00": 2 })).toBe(
      '{"\ud83d\ude00":2,"\ufb33":1}',
    );
  });
});

describe("sha256Hex", () => {
  it("matches the known empty-string vector", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches the known abc vector", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("hashCanonical", () => {
  it("is 64 lowercase hex characters", () => {
    expect(hashCanonical({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is independent of key order", () => {
    expect(hashCanonical({ a: 1, b: 2 })).toBe(hashCanonical({ b: 2, a: 1 }));
  });

  it("changes when a value changes", () => {
    expect(hashCanonical({ a: 1 })).not.toBe(hashCanonical({ a: 2 }));
  });
});

describe("byteLength", () => {
  it("counts bytes, not characters, because HCS limits bytes", () => {
    expect(byteLength("abc")).toBe(3);
    expect(byteLength("é")).toBe(2);
    expect(byteLength("\u{1f512}")).toBe(4);
  });
});
