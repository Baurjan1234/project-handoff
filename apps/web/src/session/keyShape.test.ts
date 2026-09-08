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

  it("accepts a raw scalar, with or without 0x, and leaves the curve to be taken from the account", () => {
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
    // Public keys in every DER form the portal and the SDK produce: ED25519, ECDSA, older ECDSA.
    for (const publicKey of [
      `302a300506032b6570032100${scalar}`,
      `302d300706052b8104000a03220002${scalar}`,
      `3036301006072a8648ce3d020106052b8104000a03220002${scalar}`,
    ]) {
      expect(describePrivateKey(publicKey)).toMatchObject({ ok: false, reason: expect.stringContaining("public key") });
    }
    // An EVM address, 40 hex. A pattern, not anyone's alias.
    expect(describePrivateKey(`0x${"cd".repeat(20)}`)).toMatchObject({
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
