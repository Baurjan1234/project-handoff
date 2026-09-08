import { describe, expect, it } from "vitest";
import { PrivateKey } from "@hiero-ledger/sdk";
import { createX402Signer } from "./compose.js";

const RESOURCE = "http://localhost:4021/orders";
const CAP = "100000000";

function signerFor(privateKey: string) {
  return createX402Signer({
    accountId: "0.0.10376659",
    privateKey,
    resourceUrl: RESOURCE,
    maxAmountTinybars: CAP,
  });
}

describe("createX402Signer", () => {
  it("reads a raw hex key as ECDSA, because raw text names no curve", () => {
    // The generic parser reads raw hex as ED25519, which the key-type guard
    // then refuses — a live ECDSA account was blocked by exactly this on
    // 2026-09-08. This signer is ECDSA-only, so ECDSA is the only reading that
    // can be right.
    const raw = PrivateKey.generateECDSA().toStringRaw();

    expect(signerFor(raw).accountId).toBe("0.0.10376659");
  });

  it("accepts the same raw key with an 0x prefix", () => {
    const raw = PrivateKey.generateECDSA().toStringRaw();

    expect(signerFor(`0x${raw}`).accountId).toBe("0.0.10376659");
  });

  it("takes a DER ECDSA key as it stands, because DER names its curve", () => {
    expect(signerFor(PrivateKey.generateECDSA().toStringDer()).accountId).toBe("0.0.10376659");
  });

  it("still refuses a DER ED25519 key, by key type rather than by signature", () => {
    expect(() => signerFor(PrivateKey.generateED25519().toStringDer())).toThrow(/ECDSA/);
  });

  it("carries the cap through, so a hostile quote is refused by a number", () => {
    expect(signerFor(PrivateKey.generateECDSA().toStringRaw()).maxAmountTinybars).toBe(CAP);
  });
});
