/**
 * Provision a **development** escrow account and write it into `.env`.
 *
 * Not the shared one. `docs/decisions/2026-09-07-one-shared-escrow-account-this-week.md`
 * says the escrow is provisioned once, out of band, and every order locks into
 * it — that account is P1's and this script does not replace it. This exists so
 * a single machine can run `HANDOFF_CHAIN=testnet` end to end before the shared
 * account and its vault keys are handed round. Swap in the real values before
 * anything is recorded, or the demo shows one laptop's private escrow.
 *
 * **The two platform keys are never printed.** They are appended straight to
 * `.env`, which is the only place they may live, and the script says only what
 * account it made. A key on a terminal is a key in a scrollback buffer, a
 * screen recording and an agent transcript.
 *
 * The requester slot in the 2-of-3 KeyList is this operator's own public key —
 * the demo requester's session key, exactly as the decision describes. Say that
 * out loud if a judge asks who holds the third key.
 *
 * Run from this package, through tsx — bare `node` cannot resolve the `.js`
 * specifiers inside `@handoff/schema` when the files are still `.ts`:
 *
 *   cd packages/chain
 *   node --env-file=../../.env "$(which npx)" tsx scripts/provision-dev-escrow.ts
 */
import { appendFileSync, readFileSync } from "node:fs";
import { PrivateKey } from "@hiero-ledger/sdk";
import { createTestnetClient, loadChainEnv } from "../src/config.ts";
import { buildEscrowKeyList } from "../src/keys.ts";
import { createEscrowAccount } from "../src/escrow.ts";

/** Covers the account's own existence and auto-renew. Order value arrives per order. */
const INITIAL_BALANCE_HBAR = "5";

const ENV_PATH = new URL("../../../.env", import.meta.url).pathname;

const NAMES = [
  "HANDOFF_ESCROW_ACCOUNT_ID",
  "HANDOFF_VERIFIER_KEY",
  "HANDOFF_SCHEDULE_ADMIN_KEY",
] as const;

function alreadySet(): readonly string[] {
  let current = "";
  try {
    current = readFileSync(ENV_PATH, "utf8");
  } catch {
    return [];
  }
  return NAMES.filter((name) => new RegExp(`^${name}=.+$`, "m").test(current));
}

async function main(): Promise<void> {
  const occupied = alreadySet();
  if (occupied.length > 0) {
    // Refusing beats appending. A second value for the same name shadows the
    // first depending on who reads the file, and the failure would look like a
    // signature problem rather than a duplicated line.
    console.error(
      `.env already sets ${occupied.join(", ")}. Refusing to append a second value.\n` +
        `Delete those lines first if you mean to replace the escrow, and remember ` +
        `funds in the old account stay there.`,
    );
    process.exitCode = 1;
    return;
  }

  const env = loadChainEnv();
  const client = createTestnetClient(env);

  // Three distinct roles, no person holding two. The requester slot is the
  // operator's own key this week; the other two are the platform's half of the
  // payout and are what this script writes to .env.
  const verifierKey = PrivateKey.generateED25519();
  const scheduleAdminKey = PrivateKey.generateED25519();

  const keyList = buildEscrowKeyList({
    requester: env.operatorKey.publicKey,
    verifier: verifierKey.publicKey,
    scheduleAdmin: scheduleAdminKey.publicKey,
  });

  const created = await createEscrowAccount(client, keyList, INITIAL_BALANCE_HBAR);
  const accountId = created.result.accountId.toString();

  appendFileSync(
    ENV_PATH,
    `\n# Development escrow, created ${new Date().toISOString()} by ` +
      `packages/chain/scripts/provision-dev-escrow.ts.\n` +
      `# NOT the shared escrow. Replace with P1's account and keys before recording.\n` +
      `HANDOFF_ESCROW_ACCOUNT_ID=${accountId}\n` +
      `HANDOFF_VERIFIER_KEY=${verifierKey.toStringDer()}\n` +
      `HANDOFF_SCHEDULE_ADMIN_KEY=${scheduleAdminKey.toStringDer()}\n`,
  );

  // Account id only. It is public on any mirror node; the keys are not, and
  // this is the one place they exist.
  console.log(`escrow account   ${accountId}`);
  console.log(`funded with      ${INITIAL_BALANCE_HBAR} HBAR`);
  console.log(`create tx        ${created.transactionId}`);
  console.log(`hashscan         https://hashscan.io/testnet/account/${accountId}`);
  console.log(`\nwrote HANDOFF_ESCROW_ACCOUNT_ID and the two platform keys to .env.`);
  console.log(`the keys were not printed. they are in .env and nowhere else.`);

  client.close();
}

await main();
