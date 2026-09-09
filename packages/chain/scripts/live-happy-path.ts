/**
 * Proves the direct-payout replacement end to end on real testnet: lockFunds ->
 * createSchedule (bookkeeping only) -> signSchedule (real co-signed payout) ->
 * getTransaction (mirror confirms SUCCESS). Run before trusting the decision in
 * docs/decisions/2026-09-08-direct-cosigned-payout-replaces-schedulecreate.md, not
 * just after writing it.
 */
import { PrivateKey } from "@hiero-ledger/sdk";
import { createTestnetClient, loadChainEnv } from "../src/config.ts";
import { buildEscrowKeyList } from "../src/keys.ts";
import { createEscrowAccount } from "../src/escrow.ts";
import { HederaChainAdapter } from "../src/hedera-adapter.ts";

function log(step: string, detail: unknown): void {
  console.log(`\n=== ${step} ===`);
  console.log(JSON.stringify(detail, null, 2));
}

async function main(): Promise<void> {
  const env = loadChainEnv();
  const client = createTestnetClient(env);

  const verifierKey = PrivateKey.generateED25519();
  const scheduleAdminKey = PrivateKey.generateED25519();

  const keyList = buildEscrowKeyList({
    requester: env.operatorKey.publicKey,
    verifier: verifierKey.publicKey,
    scheduleAdmin: scheduleAdminKey.publicKey,
  });

  const escrow = await createEscrowAccount(client, keyList, "5");
  log("escrow account created (real)", { transactionId: escrow.transactionId, accountId: escrow.result.accountId.toString() });

  const adapter = new HederaChainAdapter({
    client,
    mirrorNodeUrl: env.mirrorNodeUrl,
    escrowAccountId: escrow.result.accountId,
    verifierKey,
    scheduleAdminKey,
  });

  // POSTED: lock funds into escrow — real transfer.
  const lockResult = await adapter.lockFunds({
    orderId: "demo-order-1",
    amountTinybars: "150000000", // 1.5 HBAR
    requesterAccountId: env.operatorId.toString(),
  });
  log("POSTED: lockFunds (real)", lockResult);

  // CLAIMED: payee known, "create schedule" — bookkeeping only, no chain call.
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const scheduleResult = await adapter.createSchedule({
    orderId: "demo-order-1",
    escrowAccountId: lockResult.escrowAccountId,
    payeeAccountId: env.operatorId.toString(), // paying back to operator for this proof run
    amountTinybars: "150000000",
    expiresAt,
  });
  log("CLAIMED: createSchedule (local bookkeeping, no chain call)", scheduleResult);

  // Idempotency check: identical params return the same id, alreadyExisted true.
  const scheduleResultAgain = await adapter.createSchedule({
    orderId: "demo-order-1",
    escrowAccountId: lockResult.escrowAccountId,
    payeeAccountId: env.operatorId.toString(),
    amountTinybars: "150000000",
    expiresAt,
  });
  log("createSchedule called again with identical params", scheduleResultAgain);

  // DELIVERED -> SETTLED: attestation validated (not modeled here), release payment.
  const signResult = await adapter.signSchedule(scheduleResult.scheduleId);
  log("SETTLED: signSchedule (real co-signed TransferTransaction)", signResult);

  // Idempotency check: signing again must not pay twice.
  const signResultAgain = await adapter.signSchedule(scheduleResult.scheduleId);
  log("signSchedule called again (must not double-pay)", signResultAgain);

  await new Promise((resolve) => setTimeout(resolve, 6000)); // mirror-node indexing delay

  const record = await adapter.getTransaction(signResult.transactionId);
  log("getTransaction via mirror node (settlement confirmed, not assumed)", record);

  client.close();
}

main().catch((error: unknown) => {
  console.error("\n=== SCRIPT FAILED ===");
  console.error(error);
  process.exit(1);
});
