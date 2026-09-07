/**
 * Second diagnostic: is INVALID_SIGNATURE about "operator's own key also being a
 * KeyList member" (self-reference) specifically, or about "the debited account is
 * ANY KeyList" in general? Uses three keys, none of them the operator's.
 */
import { KeyList, PrivateKey } from "@hiero-ledger/sdk";
import { createEscrowAccount, createTestnetClient, loadChainEnv } from "../src/index.ts";
import { ScheduleCreateTransaction, Timestamp, TransferTransaction } from "@hiero-ledger/sdk";

async function main(): Promise<void> {
  const env = loadChainEnv();
  const client = createTestnetClient(env);

  const keyA = PrivateKey.generateECDSA();
  const keyB = PrivateKey.generateECDSA();
  const keyC = PrivateKey.generateECDSA();
  const keyList = new KeyList([keyA.publicKey, keyB.publicKey, keyC.publicKey], 2);

  const escrow = await createEscrowAccount(client, keyList, "5");
  console.log("escrow (no operator key in the list):", escrow.result.accountId.toString());

  const transfer = new TransferTransaction()
    .addHbarTransfer(escrow.result.accountId, -100_000_000)
    .addHbarTransfer(env.operatorId, 100_000_000);

  const tx = new ScheduleCreateTransaction()
    .setScheduledTransaction(transfer)
    .setAdminKey(keyC.publicKey)
    .setExpirationTime(Timestamp.fromDate(new Date(Date.now() + 5 * 60_000)));

  console.log("submitting schedule debiting a KeyList account with NO operator overlap...");
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
