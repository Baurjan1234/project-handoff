/**
 * Fourth diagnostic: does the KeyList's key TYPE matter? Every prior attempt used
 * ECDSA keys for the KeyList members. Try ED25519 instead, everything else identical
 * to diagnostic 2/3.
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
  console.log("escrow (ED25519 KeyList members):", escrow.result.accountId.toString());

  const transfer = new TransferTransaction()
    .addHbarTransfer(escrow.result.accountId, Hbar.fromTinybars(-100_000_000))
    .addHbarTransfer(env.operatorId, Hbar.fromTinybars(100_000_000));

  const tx = new ScheduleCreateTransaction()
    .setScheduledTransaction(transfer)
    .setAdminKey(keyC.publicKey)
    .setExpirationTime(Timestamp.fromDate(new Date(Date.now() + 5 * 60_000)));

  console.log("submitting (no extra co-sign, plain payer-only submit)...");
  const response = await tx.execute(client);
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
