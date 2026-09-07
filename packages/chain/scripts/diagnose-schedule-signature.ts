/**
 * Diagnostic follow-up to confirm-schedule-at-claim.ts's INVALID_SIGNATURE failure.
 * Isolates whether scheduling a transfer FROM a plain single-key account (the
 * operator itself) also fails, to tell apart "something wrong with scheduling in
 * general on this account" from "something specific to a KeyList-controlled escrow."
 */
import { ScheduleCreateTransaction, Timestamp, TransferTransaction } from "@hiero-ledger/sdk";
import { createTestnetClient, loadChainEnv } from "../src/index.ts";

async function main(): Promise<void> {
  const env = loadChainEnv();
  const client = createTestnetClient(env);

  const transfer = new TransferTransaction()
    .addHbarTransfer(env.operatorId, -1)
    .addHbarTransfer(env.operatorId, 1); // net zero, self-transfer — simplest possible case, no KeyList involved

  const tx = new ScheduleCreateTransaction()
    .setScheduledTransaction(transfer)
    .setAdminKey(env.operatorKey.publicKey)
    .setExpirationTime(Timestamp.fromDate(new Date(Date.now() + 5 * 60_000)));

  console.log("submitting plain-operator scheduled transfer...");
  const response = await tx.execute(client);
  try {
    const receipt = await response.getReceipt(client);
    console.log("SUCCESS:", { transactionId: response.transactionId.toString(), scheduleId: receipt.scheduleId?.toString() });
  } catch (error) {
    console.log("FAILED:", error instanceof Error ? error.message : error);
  }

  client.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
