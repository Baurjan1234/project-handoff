/**
 * Third diagnostic: does explicitly co-signing the ScheduleCreateTransaction itself
 * with one KeyList member (not just relying on the payer's implicit signature) avoid
 * the INVALID_SIGNATURE seen in diagnostics 1 and 2?
 */
import { KeyList, PrivateKey, ScheduleCreateTransaction, Timestamp, TransferTransaction } from "@hiero-ledger/sdk";
import { createEscrowAccount, createTestnetClient, loadChainEnv } from "../src/index.ts";

async function main(): Promise<void> {
  const env = loadChainEnv();
  const client = createTestnetClient(env);

  const keyA = PrivateKey.generateECDSA();
  const keyB = PrivateKey.generateECDSA();
  const keyC = PrivateKey.generateECDSA();
  const keyList = new KeyList([keyA.publicKey, keyB.publicKey, keyC.publicKey], 2);

  const escrow = await createEscrowAccount(client, keyList, "5");
  console.log("escrow:", escrow.result.accountId.toString());

  const transfer = new TransferTransaction()
    .addHbarTransfer(escrow.result.accountId, -100_000_000)
    .addHbarTransfer(env.operatorId, 100_000_000);

  const tx = new ScheduleCreateTransaction()
    .setScheduledTransaction(transfer)
    .setAdminKey(keyC.publicKey)
    .setExpirationTime(Timestamp.fromDate(new Date(Date.now() + 5 * 60_000)));

  console.log("freezing, co-signing with keyA (one of two needed) before submit...");
  const frozen = await tx.freezeWith(client).sign(keyA);
  const response = await frozen.execute(client);
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
