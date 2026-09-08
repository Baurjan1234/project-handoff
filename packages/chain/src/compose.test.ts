import { describe, expect, it } from "vitest";
import { PrivateKey } from "@hiero-ledger/sdk";
import { AccountId } from "@hiero-ledger/sdk";
import { assertOperatorKeyMatches, createX402Signer } from "./compose.js";
import type { ChainEnv } from "./config.js";

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


describe("assertOperatorKeyMatches", () => {
  function envFor(key: ReturnType<typeof PrivateKey.generateECDSA>): ChainEnv {
    return {
      network: "testnet",
      operatorId: AccountId.fromString("0.0.10376667"),
      operatorKey: key,
      mirrorNodeUrl: "https://testnet.mirrornode.hedera.com/api/v1",
    };
  }

  function mirror(body: unknown, status = 200): typeof fetch {
    return (async () =>
      new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  }

  it("passes when the key derives the account's key on chain", async () => {
    const key = PrivateKey.generateECDSA();
    const answer = mirror({ key: { key: key.publicKey.toStringRaw(), _type: "ECDSA_SECP256K1" } });

    await expect(assertOperatorKeyMatches(envFor(key), answer)).resolves.toBeUndefined();
  });

  it("throws on a proven mismatch, naming both keys and the fix", async () => {
    // The failure this exists to catch: a raw key read on the wrong curve is a
    // valid key for a different account, and the network only ever says
    // INVALID_SIGNATURE.
    const other = PrivateKey.generateED25519().publicKey.toStringRaw();
    const answer = mirror({ key: { key: other, _type: "ED25519" } });

    await expect(assertOperatorKeyMatches(envFor(PrivateKey.generateECDSA()), answer)).rejects.toThrow(
      /HEDERA_KEY_TYPE=ED25519/,
    );
  });

  it("does not block when the mirror node is unreachable", async () => {
    // Refusing to start on a mirror outage is a worse failure than the one
    // this prevents.
    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    await expect(assertOperatorKeyMatches(envFor(PrivateKey.generateECDSA()), down)).resolves
      .toBeUndefined();
  });

  it("says nothing about a threshold-key operator, which reports no bare key", async () => {
    const answer = mirror({ key: { key: undefined, _type: "ProtobufEncoded" } });

    await expect(assertOperatorKeyMatches(envFor(PrivateKey.generateECDSA()), answer)).resolves
      .toBeUndefined();
  });
});
