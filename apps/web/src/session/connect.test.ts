import { describe, expect, it } from "vitest";
import { assessConnect, balanceWords, buildConnection, describeConnectError, type ConnectDraft } from "./connect";
import { describePrivateKey } from "./keyShape";
import type { AccountLookup } from "./mirrorAccount";
import { SecretKey } from "./secret";

const ACCOUNT = "0.0.12345";
const scalar = "ab".repeat(32);
const derEcdsa = describePrivateKey(`3030020100300706052b8104000a04220420${scalar}`);
const derEd25519 = describePrivateKey(`302e020100300506032b657004220420${scalar}`);
const raw = describePrivateKey(scalar);

type Found = Extract<AccountLookup, { status: "found" }>;

const found = (keyType: "ECDSA_SECP256K1" | "ED25519", balanceTinybars: string | null = "100000000000"): Found => ({
  status: "found",
  accountId: ACCOUNT,
  keyType,
  // A different pattern from the private scalar, so "the key is not in here" can fail.
  publicKey: `02${"ef".repeat(32)}`,
  balanceTinybars,
  deleted: false,
});

const testnet = (over: Partial<ConnectDraft>): ConnectDraft => ({
  mode: "testnet",
  accountIdText: ACCOUNT,
  keyShape: null,
  lookup: null,
  ...over,
});

describe("assessConnect on the mock", () => {
  it("needs the account id only, and never a key or a mirror read", () => {
    const ready = assessConnect({ mode: "mock", accountIdText: ACCOUNT, keyShape: null, lookup: null });
    expect(ready).toEqual({ accountId: ACCOUNT, blockers: [], warnings: [], keyType: null, ready: true });

    const blocked = assessConnect({ mode: "mock", accountIdText: "", keyShape: null, lookup: null });
    expect(blocked.ready).toBe(false);
    expect(blocked.blockers).toHaveLength(1);
  });
});

describe("assessConnect on testnet", () => {
  it("is not ready until the mirror node has answered and a key has a shape", () => {
    const waiting = assessConnect(testnet({}));
    expect(waiting.ready).toBe(false);
    expect(waiting.blockers).toEqual([
      "Waiting for testnet's mirror node, its public read API, to confirm the account.",
      "Paste the private key of the account above.",
    ]);
  });

  it("connects a DER key whose curve matches the account, and pins that curve", () => {
    const a = assessConnect(testnet({ keyShape: derEcdsa, lookup: found("ECDSA_SECP256K1") }));
    expect(a).toMatchObject({ ready: true, blockers: [], warnings: [], keyType: "ECDSA_SECP256K1" });
  });

  it("refuses a DER key on the wrong curve, naming both", () => {
    const a = assessConnect(testnet({ keyShape: derEd25519, lookup: found("ECDSA_SECP256K1") }));
    expect(a.ready).toBe(false);
    expect(a.blockers[0]).toContain("This key is ED25519");
    expect(a.blockers[0]).toContain("ECDSA key");
  });

  it("takes a raw key's curve from the account, and refuses to guess without it", () => {
    expect(assessConnect(testnet({ keyShape: raw, lookup: found("ED25519") }))).toMatchObject({
      ready: true,
      keyType: "ED25519",
    });
    const unreachable = assessConnect(
      testnet({ keyShape: raw, lookup: { status: "unreachable", accountId: ACCOUNT, reason: "HTTP 503" } }),
    );
    expect(unreachable.ready).toBe(false);
    expect(unreachable.blockers[0]).toContain("plain hex key does not say which type");
  });

  it("lets a DER key through an unreachable mirror node with a warning, not a wall", () => {
    const a = assessConnect(
      testnet({ keyShape: derEcdsa, lookup: { status: "unreachable", accountId: ACCOUNT, reason: "no answer in 5 s" } }),
    );
    expect(a).toMatchObject({ ready: true, keyType: "ECDSA_SECP256K1" });
    expect(a.warnings[0]).toContain("no answer in 5 s");
    expect(a.warnings[0]).toContain("the first signature will fail and say so");
  });

  it("blocks on an account that is missing, deleted or not singly keyed", () => {
    expect(assessConnect(testnet({ keyShape: derEcdsa, lookup: { status: "not-found", accountId: ACCOUNT } })).blockers[0]).toContain(
      "not on testnet",
    );
    const deleted = assessConnect(testnet({ keyShape: derEcdsa, lookup: { ...found("ECDSA_SECP256K1", "0"), deleted: true } }));
    expect(deleted.blockers[0]).toContain("deleted");
    // Nothing to top up on a deleted account.
    expect(deleted.warnings).toEqual([]);
    expect(
      assessConnect(
        testnet({ keyShape: derEcdsa, lookup: { status: "unsupported-key", accountId: ACCOUNT, reported: "ProtobufEncoded" } }),
      ).blockers[0],
    ).toContain("ProtobufEncoded");
  });

  it("warns about an account that cannot pay a fee, and says where to get test HBAR", () => {
    const empty = assessConnect(testnet({ keyShape: derEcdsa, lookup: found("ECDSA_SECP256K1", "0") }));
    expect(empty.ready).toBe(true);
    expect(empty.warnings[0]).toContain("0 HBAR");
    expect(empty.warnings[0]).toContain("Hedera portal");
    // A few tinybars is not enough either; a whole HBAR is.
    expect(assessConnect(testnet({ keyShape: derEcdsa, lookup: found("ECDSA_SECP256K1", "1") })).warnings).toHaveLength(1);
    expect(assessConnect(testnet({ keyShape: derEcdsa, lookup: found("ECDSA_SECP256K1", "99999999") })).warnings).toHaveLength(1);
    expect(assessConnect(testnet({ keyShape: derEcdsa, lookup: found("ECDSA_SECP256K1", "100000000") })).warnings).toEqual([]);
    // A balance the mirror node could not carry exactly is not a warning either way.
    expect(assessConnect(testnet({ keyShape: derEcdsa, lookup: found("ECDSA_SECP256K1", null) })).warnings).toEqual([]);
  });

  it("puts the key's own problem on the list, and nothing about the key itself", () => {
    const a = assessConnect(testnet({ keyShape: describePrivateKey(ACCOUNT), lookup: found("ECDSA_SECP256K1") }));
    expect(a.blockers).toEqual(["That is an account id, not a key."]);
  });

  it("does not ask the mirror node about an id that does not parse", () => {
    const a = assessConnect(testnet({ accountIdText: "nope", keyShape: derEcdsa, lookup: found("ECDSA_SECP256K1") }));
    expect(a.accountId).toBeNull();
    expect(a.blockers).toEqual(["An account id looks like 0.0.12345."]);
  });
});

describe("buildConnection", () => {
  const assess = (draft: ConnectDraft) => ({ mode: draft.mode, assessment: assessConnect(draft), lookup: draft.lookup });

  it("on the mock, never reads the key field", () => {
    let reads = 0;
    const connection = buildConnection(assess({ mode: "mock", accountIdText: ACCOUNT, keyShape: null, lookup: null }), () => {
      reads += 1;
      return "never";
    });
    expect(connection).toEqual({ mode: "mock", accountId: ACCOUNT });
    expect(reads).toBe(0);
  });

  it("on testnet, reads the key once, pins the curve, and carries the account's public key", () => {
    let reads = 0;
    const lookup = found("ED25519");
    const connection = buildConnection(assess(testnet({ keyShape: raw, lookup })), () => {
      reads += 1;
      return ` ${scalar} `;
    });
    expect(reads).toBe(1);
    if (connection === null || connection.mode !== "testnet") throw new Error("expected a testnet connection");
    expect(connection.accountId).toBe(ACCOUNT);
    expect(connection.credential.kind).toBe("key");
    expect(connection.credential.keyType).toBe("ED25519");
    expect(connection.accountPublicKey).toBe(lookup.publicKey);
    expect(connection.credential.key.useOnce((text) => text)).toBe(scalar);
    expect(JSON.stringify(connection)).not.toContain(scalar.slice(-16));
  });

  it("carries no public key when the mirror node did not answer, and nothing at all when not ready", () => {
    const unreachable = { status: "unreachable", accountId: ACCOUNT, reason: "HTTP 503" } as const;
    const connection = buildConnection(assess(testnet({ keyShape: derEcdsa, lookup: unreachable })), () => scalar);
    expect(connection).toMatchObject({ mode: "testnet", accountPublicKey: null });

    let reads = 0;
    expect(
      buildConnection(assess(testnet({ keyShape: null, lookup: found("ECDSA_SECP256K1") })), () => {
        reads += 1;
        return scalar;
      }),
    ).toBeNull();
    expect(reads).toBe(0);
  });
});

describe("balanceWords", () => {
  it("shows HBAR from the tinybar string, or nothing", () => {
    expect(balanceWords(found("ECDSA_SECP256K1"))).toBe("1000 HBAR");
    expect(balanceWords(found("ECDSA_SECP256K1", null))).toBeNull();
    expect(balanceWords({ status: "not-found", accountId: ACCOUNT })).toBeNull();
  });
});

describe("describeConnectError", () => {
  it("uses its own words for the errors it knows", () => {
    const mismatch = new Error("key 3030…ab does not match");
    mismatch.name = "KeyMismatchError";
    expect(describeConnectError(mismatch, ACCOUNT)).toBe(
      `This key does not belong to account ${ACCOUNT}. Paste the key the portal shows for it.`,
    );

    const key = SecretKey.fromInput(scalar);
    key.dispose();
    let spent: unknown = null;
    try {
      key.useOnce(() => undefined);
    } catch (error) {
      spent = error;
    }
    expect(describeConnectError(spent, ACCOUNT)).toContain("Paste it again");
  });

  it("scrubs a message it does not know, in case it quotes the key", () => {
    const shown = describeConnectError(new Error(`invalid private key: ${scalar}`), ACCOUNT);
    expect(shown).toBe("invalid private key: [withheld]");
    expect(describeConnectError("plain string", ACCOUNT)).toBe("plain string");
  });
});
