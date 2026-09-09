/**
 * Provisions the ONE shared escrow account and the two platform keys, once, and
 * appends them to .env.
 *
 * Why this script exists: `live-happy-path.ts` generates the verifier and
 * schedule-admin keys fresh on every run, which proves the mechanism and leaves
 * nothing behind. A demo needs an escrow account that is the same account tomorrow,
 * with keys somebody still holds — otherwise every run is a different escrow and the
 * ledger tells a different story each take.
 *
 * ## Where these keys belong
 *
 * `CLAUDE.md`: *"Vault — Operator key and Supabase service key. Nowhere else, ever."*
 * The platform keys are the same class of secret, so **the Vault is their real home**
 * and `.env` here is the local development stand-in. Whoever runs this should put the
 * two keys in the shared vault entry as well, or the escrow becomes unrecoverable the
 * moment this machine is not around.
 *
 * ## The 2-of-3
 *
 * requester + verifier + schedule-admin, threshold 2, per
 * `../../docs/decisions/2026-09-07-one-shared-escrow-account-this-week.md`.
 * Verifier + schedule-admin is the payout path, which is why the platform can pay
 * without the requester. Requester + either platform key is the clawback path.
 *
 * The requester slot takes the account passed as `--requester`, defaulting to the
 * operator. That is the demo requester's session key, and the decision says to say
 * so out loud if a judge asks who holds the third key.
 *
 * Run: node --env-file=../../.env $(which npx) tsx scripts/provision-escrow.ts
 */
import { appendFileSync } from "node:fs";
import { PrivateKey } from "@hiero-ledger/sdk";
import { createTestnetClient, loadChainEnv } from "../src/config.ts";
import { createEscrowAccount } from "../src/escrow.ts";
import { buildEscrowKeyList } from "../src/keys.ts";

const ENV_PATH = new URL("../../../.env", import.meta.url).pathname;

/** Covers the account's own existence and the auto-renew buffer, not any order's price. */
const ESCROW_INITIAL_HBAR = "10";

async function main(): Promise<void> {
  const env = loadChainEnv();
  const client = createTestnetClient(env);

  // The two platform keys. Generated once, here, and kept.
  const verifierKey = PrivateKey.generateED25519();
  const scheduleAdminKey = PrivateKey.generateED25519();

  // The requester slot is the demo requester's session key — the operator, unless the
  // demo grows a separate requester account that can sign its own fund-lock.
  const requesterPublicKey = env.operatorKey.publicKey;

  const keyList = buildEscrowKeyList({
    requester: requesterPublicKey,
    verifier: verifierKey.publicKey,
    scheduleAdmin: scheduleAdminKey.publicKey,
  });

  const escrow = await createEscrowAccount(client, keyList, ESCROW_INITIAL_HBAR);
  const escrowAccountId = escrow.result.accountId.toString();

  appendFileSync(
    ENV_PATH,
    [
      "",
      `# The shared escrow account and the two platform keys, provisioned ${new Date().toISOString().slice(0, 10)}.`,
      "# 2-of-3 KeyList: requester (the operator, as the demo requester's session key),",
      "# verifier, schedule-admin. Verifier + schedule-admin is the payout path; requester",
      "# + either platform key is the clawback path.",
      "#",
      "# THE VAULT IS THESE KEYS' REAL HOME (CLAUDE.md: operator and service keys live",
      "# there and nowhere else). This .env copy is the local dev stand-in — put them in",
      "# the shared vault entry too, or the escrow is unrecoverable off this machine.",
      `HANDOFF_ESCROW_ACCOUNT_ID=${escrowAccountId}`,
      `HANDOFF_VERIFIER_KEY=${verifierKey.toStringDer()}`,
      `HANDOFF_SCHEDULE_ADMIN_KEY=${scheduleAdminKey.toStringDer()}`,
      "",
    ].join("\n"),
  );

  console.log(`escrow account: ${escrowAccountId}  (${ESCROW_INITIAL_HBAR} HBAR)`);
  console.log(`  KeyList 2-of-3: requester=${env.operatorId.toString()} (operator), verifier, schedule-admin`);
  console.log(`  create tx: ${escrow.transactionId}`);
  console.log(`\nplatform keys appended to .env — not printed here on purpose.`);
  console.log(`\n>>> Put HANDOFF_VERIFIER_KEY and HANDOFF_SCHEDULE_ADMIN_KEY in the shared vault too. <<<`);
  console.log(`\nHashscan: https://hashscan.io/testnet/account/${escrowAccountId}`);

  client.close();
}

main().catch((error: unknown) => {
  console.error("\n=== FAILED ===");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
