import { describe, expect, it } from "vitest";
import { describeKeyShape, describePrivateKey } from "./keyShape";

// Fabricated scalars. Not keys to anything; the bytes are a pattern.
const scalar = "ab".repeat(32);
const derEd25519 = `302e020100300506032b657004220420${scalar}`;
const derEcdsa = `3030020100300706052b8104000a04220420${scalar}`;

describe("describePrivateKey", () => {
  it("names the curve of a DER key by its prefix", () => {
    expect(describePrivateKey(derEd25519)).toEqual({ ok: true, encoding: "der", curve: "ED25519" });
    expect(describePrivateKey(derEcdsa)).toEqual({ ok: true, encoding: "der", curve: "ECDSA_SECP256K1" });
    expect(describePrivateKey(derEcdsa.toUpperCase())).toEqual({ ok: true, encoding: "der", curve: "ECDSA_SECP256K1" });
  });

  it("accepts a raw scalar, with or without 0x, and leaves the curve to the adapter", () => {
    expect(describePrivateKey(scalar)).toEqual({ ok: true, encoding: "raw", curve: null });
    expect(describePrivateKey(`0x${scalar}`)).toEqual({ ok: true, encoding: "raw", curve: null });
    expect(describePrivateKey(`  ${scalar}\n`)).toEqual({ ok: true, encoding: "raw", curve: null });
  });

  it("tells an expert what they pasted instead of a key", () => {
    expect(describePrivateKey("")).toMatchObject({ ok: false });
    expect(describePrivateKey("0.0.12345")).toMatchObject({ ok: false, reason: expect.stringContaining("account id") });
    expect(describePrivateKey("-----BEGIN PRIVATE KEY-----")).toMatchObject({
      ok: false,
      reason: expect.stringContaining("PEM"),
    });
    expect(describePrivateKey("abandon abandon abandon ability")).toMatchObject({
      ok: false,
      reason: expect.stringContaining("recovery phrase"),
    });
    expect(describePrivateKey(`302a300506032b6570032100${scalar}`)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("public key"),
    });
    expect(describePrivateKey("0x41bb7bf8263e66a49d7bee6796d836709ed24afc")).toMatchObject({
      ok: false,
      reason: expect.stringContaining("This has 40"),
    });
    expect(describePrivateKey("zz".repeat(32))).toMatchObject({ ok: false, reason: expect.stringContaining("hexadecimal") });
  });

  it("refuses a DER prefix on the wrong length rather than guessing", () => {
    expect(describePrivateKey(`${derEcdsa}00`)).toMatchObject({ ok: false });
    expect(describePrivateKey(derEd25519.slice(0, -2))).toMatchObject({ ok: false });
  });

  it("describes a shape in words that never include the key", () => {
    for (const text of [derEd25519, derEcdsa, scalar, "nope"]) {
      const words = describeKeyShape(describePrivateKey(text));
      expect(words).not.toContain(scalar);
      expect(words.length).toBeGreaterThan(0);
    }
    expect(describeKeyShape(describePrivateKey(derEcdsa))).toContain("ECDSA");
  });
});
