import { AccountId, PrivateKey } from "@hiero-ledger/sdk";
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
