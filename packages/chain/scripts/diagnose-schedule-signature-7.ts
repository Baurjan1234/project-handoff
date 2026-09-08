/**
 * Seventh diagnostic: does the FULL threshold (2-of-3), not just one signature,
 * need to be met at ScheduleCreate time for a KeyList-controlled debit? Diagnostic
 * 3 tried one co-signer and failed; this tries both keyA and keyB (the full 2-of-3).
 */
import { Hbar, KeyList, PrivateKey, ScheduleCreateTransaction, Timestamp, TransferTransaction } from "@hiero-ledger/sdk";
import { createEscrowAccount, createTestnetClient, loadChainEnv } from "../src/index.ts";

async function main(): Promise<void> {
  const env = loadChainEnv();
  const client = createTestnetClient(env);

  const keyA = PrivateKey.generateED25519();
  const keyB = PrivateKey.generateED25519();
  const keyC = PrivateKey.generateED25519();
  const keyList = new KeyList([keyA.publicKey, keyB.publicKey, keyC.publicKey], 2);

  const escrow = await createEscrowAccount(client, keyList, "5");
  console.log("escrow:", escrow.result.accountId.toString());

  const transfer = new TransferTransaction()
    .addHbarTransfer(escrow.result.accountId, Hbar.fromTinybars(-100_000_000))
    .addHbarTransfer(env.operatorId, Hbar.fromTinybars(100_000_000));

  const tx = new ScheduleCreateTransaction()
    .setScheduledTransaction(transfer)
    .setAdminKey(keyC.publicKey)
    .setExpirationTime(Timestamp.fromDate(new Date(Date.now() + 5 * 60_000)));

  console.log("co-signing with BOTH keyA and keyB (the full 2-of-3 threshold) before submit...");
  const frozen = await tx.freezeWith(client).sign(keyA);
  const doubleSign = await frozen.sign(keyB);
  const response = await doubleSign.execute(client);
  try {
    const receipt = await response.getReceipt(client);
    console.log("SUCCESS:", { scheduleId: receipt.scheduleId?.toString() });
  } catch (error) {
    console.log("FAILED:", error instanceof Error ? error.message : error);
  }

  client.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
