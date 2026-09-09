/**
 * Creates the two x402 accounts and appends them to .env.
 *
 * Why not reuse the operator, which is already ECDSA: it is a member of the escrow
 * KeyList (the requester role), and "two money flows, never conflated" is a rule in
 * root CLAUDE.md — the service fee and the order value keep different accounts. The
 * x402 receiver in particular must never be the escrow.
 *
 * The payer MUST be ECDSA: X402Signer throws at construction otherwise, because the
 * x402 exact scheme is secp256k1. Generated here rather than clicked through the
 * portal, where the default key type is not ECDSA and is easy to get wrong.
 *
 * Writes the keys to .env directly rather than printing them, so they never pass
 * through a terminal transcript or a chat window. The account ids are printed,
 * because those are not secrets.
 *
 * Run: node --env-file=../../.env $(which npx) tsx scripts/provision-x402-accounts.ts
 */
import { appendFileSync } from "node:fs";
import { AccountCreateTransaction, Hbar, PrivateKey } from "@hiero-ledger/sdk";
import { createTestnetClient, loadChainEnv } from "../src/config.ts";

const ENV_PATH = new URL("../../../.env", import.meta.url).pathname;

/** Enough for many demo runs at 0.5 HBAR a call, without tying up the faucet allowance. */
const PAYER_BALANCE_HBAR = 20;
/** The receiver only has to exist and accumulate fees. */
const RECEIVER_BALANCE_HBAR = 5;

async function main(): Promise<void> {
  const env = loadChainEnv();
  const client = createTestnetClient(env);

  // The payer: ECDSA, non-negotiable.
  const payerKey = PrivateKey.generateECDSA();
  if (payerKey.type !== "secp256k1") {
    throw new Error(`generated key is ${payerKey.type}, not secp256k1 — X402Signer would refuse it`);
  }
  const payerResponse = await new AccountCreateTransaction()
    .setKey(payerKey.publicKey)
    .setInitialBalance(new Hbar(PAYER_BALANCE_HBAR))
    .execute(client);
  const payerId = (await payerResponse.getReceipt(client)).accountId;
  if (!payerId) throw new Error("no account id came back for the payer");

  // The receiver: key type does not matter, it never signs. ECDSA anyway for consistency.
  const receiverKey = PrivateKey.generateECDSA();
  const receiverResponse = await new AccountCreateTransaction()
    .setKey(receiverKey.publicKey)
    .setInitialBalance(new Hbar(RECEIVER_BALANCE_HBAR))
    .execute(client);
  const receiverId = (await receiverResponse.getReceipt(client)).accountId;
  if (!receiverId) throw new Error("no account id came back for the receiver");

  appendFileSync(
    ENV_PATH,
    [
      "",
      `# x402 accounts, provisioned ${new Date().toISOString().slice(0, 10)}. Payer is ECDSA because`,
      "# X402Signer refuses anything else. Separate from the escrow on purpose: the service",
      "# fee and the order value are two money flows that never share an account.",
      `X402_PAYER_ACCOUNT_ID=${payerId.toString()}`,
      `X402_PAYER_PRIVATE_KEY=${payerKey.toStringDer()}`,
      `X402_RECEIVER_ACCOUNT_ID=${receiverId.toString()}`,
      `# The receiver never signs, so its key is not needed by any app. Kept only so the`,
      `# account can be recovered or drained later.`,
      `X402_RECEIVER_PRIVATE_KEY=${receiverKey.toStringDer()}`,
      "# 0.5 HBAR, committed in docs/decisions/2026-09-06-demo-price-and-x402-fee.md.",
      "X402_FEE_TINYBARS=50000000",
      "",
    ].join("\n"),
  );

  console.log(`payer    ${payerId.toString()}  (ECDSA, ${PAYER_BALANCE_HBAR} HBAR)`);
  console.log(`receiver ${receiverId.toString()}  (${RECEIVER_BALANCE_HBAR} HBAR)`);
  console.log(`\nkeys appended to .env — not printed here on purpose.`);
  console.log(`X402_FEE_TINYBARS=50000000 written too.`);
  console.log(`\nHashscan:`);
  console.log(`  payer:    https://hashscan.io/testnet/account/${payerId.toString()}`);
  console.log(`  receiver: https://hashscan.io/testnet/account/${receiverId.toString()}`);

  client.close();
}

main().catch((error: unknown) => {
  console.error("\n=== FAILED ===");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
