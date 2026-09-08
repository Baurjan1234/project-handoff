import { AccountId, Client, PrivateKey } from "@hiero-ledger/sdk";

/**
 * Testnet only, always (hard rule 5, CLAUDE.md) — there is no mainnet branch in this
 * file, deliberately. Reads exactly the vars in the committed `.env.example`: the
 * per-dev operator account, plus the mirror-node base URL.
 *
 * The escrow's 2-of-3 role keys (requester, verifier, schedule-admin — see keys.ts)
 * are NOT loaded here. They are the shared, vault-only keys the CLAUDE.md "Where
 * things live" table describes — callers pass them in explicitly (as `PrivateKey` /
 * `PublicKey` values) rather than this module inventing new required env-var names
 * into a shared `.env.example` unilaterally.
 */
export interface ChainEnv {
  network: "testnet";
  operatorId: AccountId;
  operatorKey: PrivateKey;
  mirrorNodeUrl: string;
}

const DEFAULT_MIRROR_NODE_URL = "https://testnet.mirrornode.hedera.com/api/v1";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name} (see .env.example)`);
  }
  return value;
}

export function loadChainEnv(): ChainEnv {
  const network = process.env["HEDERA_NETWORK"] ?? "testnet";
  if (network !== "testnet") {
    throw new Error(`HEDERA_NETWORK must be "testnet" — got "${network}" (hard rule 5).`);
  }

  return {
    network: "testnet",
    operatorId: AccountId.fromString(requireEnv("HEDERA_ACCOUNT_ID")),
    operatorKey: parseOperatorKey(requireEnv("HEDERA_PRIVATE_KEY"), process.env["HEDERA_KEY_TYPE"]),
    mirrorNodeUrl: process.env["HEDERA_MIRROR_NODE_URL"] ?? DEFAULT_MIRROR_NODE_URL,
  };
}

/**
 * Parse the operator key, choosing the curve rather than letting the SDK guess.
 *
 * A DER key names its own curve and is parsed as it stands. A **raw** key is 64
 * hex characters and says nothing about the curve — and the generic
 * `PrivateKey.fromString` reads raw hex as ED25519. For an ECDSA account that
 * silently produces the wrong key: every transaction fails
 * `INVALID_SIGNATURE`, which names the signature rather than the parse, and the
 * account and the key were both correct all along.
 *
 * Measured 2026-09-08 against account 0.0.10376667, `ECDSA_SECP256K1` on
 * testnet, whose raw key derives the on-chain public key under
 * `fromStringECDSA` and a different one under the generic parser.
 *
 * Raw defaults to **ECDSA**, because that is what the portal's non-default
 * option produces and what this project needs anyway. An ED25519 dev account
 * with a raw key sets `HEDERA_KEY_TYPE=ED25519`; the alternative is a mirror
 * lookup, which would make this async for every caller.
 */
export function parseOperatorKey(text: string, keyType?: string): PrivateKey {
  const trimmed = text.trim();
  const hex = trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed.slice(2) : trimmed;
  const declared = keyType?.trim().toUpperCase();

  if (declared !== undefined && declared !== "" && declared !== "ECDSA" && declared !== "ED25519") {
    throw new Error(`HEDERA_KEY_TYPE is "${keyType}". Use ECDSA or ED25519, or leave it unset.`);
  }

  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    return declared === "ED25519" ? PrivateKey.fromStringED25519(hex) : PrivateKey.fromStringECDSA(hex);
  }

  // DER, or something the SDK rejects with its own message. Either way the text
  // carries its own curve and there is nothing here to decide.
  return PrivateKey.fromStringDer(hex);
}

export function createTestnetClient(env: ChainEnv): Client {
  const client = Client.forTestnet();
  client.setOperator(env.operatorId, env.operatorKey);
  return client;
}
