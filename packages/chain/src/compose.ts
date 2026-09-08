import { AccountId, PrivateKey } from "@hiero-ledger/sdk";
import { X402Signer } from "./x402-signer.js";
import { createTestnetClient, type ChainEnv } from "./config.js";
import { HederaChainAdapter } from "./hedera-adapter.js";

/**
 * Build the adapter from strings, so a composition root needs no Hedera SDK.
 *
 * `HederaChainAdapterConfig` is stated in SDK types — a `Client`, an
 * `AccountId`, two `PrivateKey`s — which is right for a package that owns the
 * chain. It leaves a gap for everyone else: the repo layout rule in CLAUDE.md
 * is that **nothing outside this package imports the Hedera SDK directly**, and
 * an app that cannot import the SDK cannot build those three values. This
 * closes that gap and changes nothing about the adapter itself.
 *
 * The env-var names stay with the caller. `config.ts` declined to invent names
 * for the platform keys into a shared `.env.example`, and that reasoning still
 * holds — this takes values already read, never a variable name.
 *
 * `resolveClaimantKey` is deliberately not settable here. A claim is published
 * from the claimant's own account, and a server-side composition root has no
 * business holding an expert's key; the adapter refuses the publish rather than
 * signing as itself. A process that genuinely is the claimant constructs
 * `HederaChainAdapter` directly and says so out loud.
 */
export interface PlatformEscrowConfig {
  /** The one shared escrow account, provisioned out of band. Never created on boot. */
  escrowAccountId: string;
  /** Vault-only. Co-signs early-execute with the schedule admin. */
  verifierKey: string;
  /** Vault-only. Co-signs early-execute, and owns ScheduleDelete. */
  scheduleAdminKey: string;
}

export function createHederaChainAdapter(
  env: ChainEnv,
  platform: PlatformEscrowConfig,
): HederaChainAdapter {
  return new HederaChainAdapter({
    client: createTestnetClient(env),
    mirrorNodeUrl: env.mirrorNodeUrl,
    escrowAccountId: AccountId.fromString(platform.escrowAccountId),
    // Generic parser, matching config.ts: a DER-exported key self-identifies
    // its curve, and these two are not guaranteed to be either one.
    verifierKey: PrivateKey.fromString(platform.verifierKey),
    scheduleAdminKey: PrivateKey.fromString(platform.scheduleAdminKey),
  });
}

/**
 * Build the x402 payer from configuration, for the same reason as above.
 *
 * `X402Signer`'s constructor takes a `PrivateKey`, which an app cannot make.
 * The key-type guard is unchanged and still runs here: an ED25519 key is
 * refused at construction, by key type, rather than at the facilitator as an
 * opaque `InvalidSignature`.
 */
export interface X402SignerStrings {
  readonly accountId: string;
  /** Must be ECDSA. Parsed generically, so a DER key names its own curve. */
  readonly privateKey: string;
  /** The resource this payment is for, absolute, as the 402 named it. */
  readonly resourceUrl: string;
  /** A ceiling this signer will not sign past, in tinybars. */
  readonly maxAmountTinybars: string;
}

/**
 * Parse an x402 payer key, choosing the curve rather than guessing it.
 *
 * A DER key names its own curve, so it is parsed as it stands. A **raw** key
 * is 64 hex characters and says nothing about the curve — and the generic
 * `PrivateKey.fromString` reads that as ED25519, which is wrong here every
 * time: this signer is ECDSA-only by contract, so ECDSA is the only reading
 * that can be correct.
 *
 * Measured, not assumed: a raw key for a live `ECDSA_SECP256K1` account was
 * refused by the key-type guard on 2026-09-08 because the generic parser had
 * already made it ED25519. The account was right and the key was right.
 */
function parsePayerKey(text: string): PrivateKey {
  const trimmed = text.trim();
  const hex = trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed.slice(2) : trimmed;

  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    return PrivateKey.fromStringECDSA(hex);
  }
  // DER, or something the SDK will reject with its own message. Either way the
  // text carries its own curve and there is nothing here to decide.
  return PrivateKey.fromStringDer(hex);
}

export function createX402Signer(config: X402SignerStrings): X402Signer {
  return new X402Signer({
    accountId: config.accountId,
    privateKey: parsePayerKey(config.privateKey),
    resourceUrl: config.resourceUrl,
    maxAmountTinybars: config.maxAmountTinybars,
  });
}

/**
 * Prove the operator key actually controls the operator account.
 *
 * A raw hex key names no curve, so `parseOperatorKey` has to choose one, and a
 * wrong choice produces a valid key for a different account. Every transaction
 * then fails `INVALID_SIGNATURE` — an error that names the signature, never the
 * curve, the variable or the file. Both directions of that mistake are silent,
 * and this is what makes them loud.
 *
 * Compares the derived public key with the one the mirror node reports. A
 * mismatch is provable and throws with the fix in the message. An unreachable
 * mirror node does **not** throw: being unable to check is not evidence of a
 * problem, and refusing to start on a mirror outage would be a worse failure
 * than the one this prevents.
 */
export async function assertOperatorKeyMatches(
  env: ChainEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const url = `${env.mirrorNodeUrl.replace(/\/+$/, "")}/accounts/${env.operatorId.toString()}?transactions=false`;

  let onChain: string | undefined;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return;
    const body = (await response.json()) as { key?: { key?: unknown; _type?: unknown } };
    onChain = typeof body.key?.key === "string" ? body.key.key : undefined;
  } catch {
    return;
  }

  // A threshold or KeyList account reports ProtobufEncoded rather than a bare
  // public key. Nothing to compare, and an operator with a complex key is
  // somebody who knows what they are doing.
  if (onChain === undefined) return;

  const derived = env.operatorKey.publicKey.toStringRaw();
  if (derived === onChain) return;

  throw new Error(
    `HEDERA_PRIVATE_KEY does not control HEDERA_ACCOUNT_ID ${env.operatorId.toString()}.\n` +
      `  the account's key on chain: ${onChain}\n` +
      `  this key derives:           ${derived}\n` +
      `A raw hex key carries no curve and is read as ECDSA by default. If this account ` +
      `was made with the portal's default, set HEDERA_KEY_TYPE=ED25519. If the key ` +
      `simply belongs to another account, fix the pair — nothing will sign until you do.`,
  );
}
