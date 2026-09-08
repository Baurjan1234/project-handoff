/**
 * Control test: is this about ScheduleCreate specifically, or about KeyList signing
 * in general? Try a PLAIN (non-scheduled) transfer debiting a KeyList account,
 * properly co-signed with 2-of-3 members, submitted directly — no schedule involved
 * at all.
 */
import { Hbar, KeyList, PrivateKey, TransferTransaction } from "@hiero-ledger/sdk";
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

  console.log("freezing + co-signing with keyA and keyB (2 of 3), plain (non-scheduled) transfer...");
  const frozen = await transfer.freezeWith(client).sign(keyA);
  const signed = await frozen.sign(keyB);
  const response = await signed.execute(client);

  try {
    const receipt = await response.getReceipt(client);
    console.log("SUCCESS:", receipt.status.toString());
  } catch (error) {
    console.log("FAILED:", error instanceof Error ? error.message : error);
  }

  client.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
