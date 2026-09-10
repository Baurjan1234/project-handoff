import { PrivateKey } from "@hiero-ledger/sdk";
import { describe, expect, it } from "vitest";
import { createExpertChain, KeyMismatchError } from "./expert-chain.js";

/**
 * The point of these tests is the leak checks. apps/web holds this object in React
 * state, so "the key is not an own property" is a requirement, not a preference —
 * asserted here rather than left to a code comment nobody re-reads.
 */
function build() {
  const key = PrivateKey.generateECDSA();
  const chain = createExpertChain({
    accountId: "0.0.12345",
    privateKeyDer: key.toStringDer(),
    mirrorNodeUrl: "https://testnet.mirrornode.hedera.com/api/v1",
  });
  return { chain, keyDer: key.toStringDer() };
}

describe("createExpertChain", () => {
  it("is testnet, with nothing to choose", () => {
    const { chain } = build();
    expect(chain.network).toBe("testnet");
    chain.close();
  });

  it("exposes only the expert's slice — no signSchedule, createSchedule, deleteSchedule or fund lock", () => {
    const { chain } = build();
    const keys = Object.keys(chain).sort();

    expect(keys).toEqual(["close", "getTransaction", "network", "readMessages", "submitMessage"]);
    expect(keys).not.toContain("signSchedule");
    expect(keys).not.toContain("createSchedule");
    expect(keys).not.toContain("deleteSchedule");
    expect(keys).not.toContain("buildFundLock");
    expect(keys).not.toContain("submitFundLock");
    chain.close();
  });

  it("does not keep the key as an own property", () => {
    const { chain, keyDer } = build();

    const ownValues = Object.values(chain).map((v) => String(v));
    for (const value of ownValues) {
      expect(value).not.toContain(keyDer);
    }
    // And no property is the key itself, under any name.
    expect(Object.getOwnPropertyNames(chain).some((n) => /key|secret|private/i.test(n))).toBe(false);
    chain.close();
  });

  it("does not leak the key through JSON.stringify — the shape an error serializer walks", () => {
    const { chain, keyDer } = build();
    const serialized = JSON.stringify(chain) ?? "";

    expect(serialized).not.toContain(keyDer);
    // The raw hex body of the key, in case the DER wrapper differs.
    expect(serialized).not.toContain(keyDer.slice(-32));
    chain.close();
  });

  it("is frozen, so nothing can bolt a key onto it later", () => {
    const { chain } = build();
    expect(Object.isFrozen(chain)).toBe(true);
    chain.close();
  });

  it("accepts a DER key string, which is what the connect screen collects", () => {
    const ed25519 = PrivateKey.generateED25519();
    const chain = createExpertChain({
      accountId: "0.0.999",
      privateKeyDer: ed25519.toStringDer(),
      mirrorNodeUrl: "https://testnet.mirrornode.hedera.com/api/v1",
    });
    expect(chain.network).toBe("testnet");
    chain.close();
  });

  it("refuses a malformed account id rather than failing later on a submit", () => {
    const key = PrivateKey.generateECDSA();
    expect(() =>
      createExpertChain({
        accountId: "not-an-account",
        privateKeyDer: key.toStringDer(),
        mirrorNodeUrl: "https://testnet.mirrornode.hedera.com/api/v1",
      }),
    ).toThrow();
  });
});

describe("createExpertChain, the key against the account", () => {
  const mirrorNodeUrl = "https://testnet.mirrornode.hedera.com/api/v1";

  it("accepts a raw hex key when told the curve, and refuses one when not", () => {
    const ecdsa = PrivateKey.generateECDSA();
    const chain = createExpertChain({
      accountId: "0.0.12345",
      privateKeyDer: ecdsa.toStringRaw(),
      keyType: "ECDSA_SECP256K1",
      mirrorNodeUrl,
    });
    expect(chain.network).toBe("testnet");
    chain.close();

    expect(() =>
      createExpertChain({ accountId: "0.0.12345", privateKeyDer: ecdsa.toStringRaw(), mirrorNodeUrl }),
    ).toThrow(/which curve/);
  });

  it("accepts the key that produces the account's public key, raw or DER, with or without 0x", () => {
    const key = PrivateKey.generateED25519();
    for (const expected of [key.publicKey.toStringRaw(), key.publicKey.toStringDer(), `0x${key.publicKey.toStringRaw()}`]) {
      const chain = createExpertChain({
        accountId: "0.0.777",
        privateKeyDer: key.toStringDer(),
        expectedPublicKey: expected,
        mirrorNodeUrl,
      });
      chain.close();
    }
  });

  it("refuses a key that does not belong to the account, naming the account and never the key", () => {
    const pasted = PrivateKey.generateECDSA();
    const actual = PrivateKey.generateECDSA();
    let caught: unknown;
    try {
      createExpertChain({
        accountId: "0.0.777",
        privateKeyDer: pasted.toStringDer(),
        expectedPublicKey: actual.publicKey.toStringRaw(),
        mirrorNodeUrl,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(KeyMismatchError);
    const message = (caught as Error).message;
    expect(message).toContain("0.0.777");
    expect(message).not.toContain(pasted.toStringRaw());
    expect(message).not.toContain(pasted.toStringDer().slice(-16));
  });
});
