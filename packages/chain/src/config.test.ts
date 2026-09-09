import { describe, expect, it } from "vitest";
import { PrivateKey } from "@hiero-ledger/sdk";
import { parseOperatorKey } from "./config.js";

describe("parseOperatorKey", () => {
  it("reads a raw hex key as ECDSA, which is what the account usually is", () => {
    // The generic PrivateKey.fromString reads raw hex as ED25519. Against an
    // ECDSA account that produced a different key entirely, and every
    // transaction failed INVALID_SIGNATURE — naming the signature, never the
    // parse. Measured against 0.0.10376667 on 2026-09-08.
    const key = PrivateKey.generateECDSA();

    expect(parseOperatorKey(key.toStringRaw()).publicKey.toStringRaw()).toBe(
      key.publicKey.toStringRaw(),
    );
  });

  it("accepts the same raw key with an 0x prefix", () => {
    const key = PrivateKey.generateECDSA();

    expect(parseOperatorKey(`0x${key.toStringRaw()}`).publicKey.toStringRaw()).toBe(
      key.publicKey.toStringRaw(),
    );
  });

  it("reads a raw key as ED25519 when the environment says so", () => {
    const key = PrivateKey.generateED25519();

    expect(parseOperatorKey(key.toStringRaw(), "ed25519").publicKey.toStringRaw()).toBe(
      key.publicKey.toStringRaw(),
    );
  });

  it("takes a DER key as it stands, on either curve, because DER names it", () => {
    const ecdsa = PrivateKey.generateECDSA();
    const ed = PrivateKey.generateED25519();

    expect(parseOperatorKey(ecdsa.toStringDer()).publicKey.toStringRaw()).toBe(
      ecdsa.publicKey.toStringRaw(),
    );
    expect(parseOperatorKey(ed.toStringDer()).publicKey.toStringRaw()).toBe(
      ed.publicKey.toStringRaw(),
    );
  });

  it("refuses a key type it does not recognise rather than ignoring it", () => {
    // Ignoring it would silently fall back to ECDSA, which is the bug this
    // whole function exists to stop.
    expect(() => parseOperatorKey(PrivateKey.generateECDSA().toStringRaw(), "secp256r1")).toThrow(
      /HEDERA_KEY_TYPE/,
    );
  });
});
