/**
 * Proves the direct-payout replacement end to end on real testnet: fund lock ->
 * createSchedule (bookkeeping only) -> signSchedule (real co-signed payout) ->
 * getTransaction (mirror confirms SUCCESS). Run before trusting the decision in
 * docs/decisions/2026-09-08-direct-cosigned-payout-replaces-schedulecreate.md, not
 * just after writing it.
 */
import { AccountId, PrivateKey, Transaction } from "@hiero-ledger/sdk";
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

  // Use the PROVISIONED escrow and platform keys when .env has them. Generating them
  // per run proves the mechanism and leaves nothing behind, which is not a demo — every
  // take would be a different escrow account on the ledger, and the platform keys would
  // exist only for the life of the process. Run provision-escrow.ts once instead.
  const provisionedEscrow = process.env["HANDOFF_ESCROW_ACCOUNT_ID"]?.trim();
  const provisionedVerifier = process.env["HANDOFF_VERIFIER_KEY"]?.trim();
  const provisionedAdmin = process.env["HANDOFF_SCHEDULE_ADMIN_KEY"]?.trim();

  let escrowAccountId: AccountId;
  let verifierKey: PrivateKey;
  let scheduleAdminKey: PrivateKey;

  if (provisionedEscrow && provisionedVerifier && provisionedAdmin) {
    escrowAccountId = AccountId.fromString(provisionedEscrow);
    verifierKey = PrivateKey.fromString(provisionedVerifier);
    scheduleAdminKey = PrivateKey.fromString(provisionedAdmin);
    log("using the provisioned escrow from .env", { escrowAccountId: escrowAccountId.toString() });
  } else {
    verifierKey = PrivateKey.generateED25519();
    scheduleAdminKey = PrivateKey.generateED25519();
    const keyList = buildEscrowKeyList({
      requester: env.operatorKey.publicKey,
      verifier: verifierKey.publicKey,
      scheduleAdmin: scheduleAdminKey.publicKey,
    });
    const created = await createEscrowAccount(client, keyList, "5");
    escrowAccountId = created.result.accountId;
    log("no provisioned escrow in .env — created a throwaway", {
      transactionId: created.transactionId,
      accountId: escrowAccountId.toString(),
      note: "run provision-escrow.ts to make this persistent",
    });
  }

  const adapter = new HederaChainAdapter({
    client,
    mirrorNodeUrl: env.mirrorNodeUrl,
    escrowAccountId,
    verifierKey,
    scheduleAdminKey,
  });

  // POSTED: lock funds into escrow — real transfer, signed by the requester.
  //
  // In this proof run the requester and the operator are the same account, so
  // the script holds the key it signs with. On the real path they are
  // different accounts and this signature happens on the requester's machine;
  // the server only ever sees the bytes that come back.
  const lockParams = {
    orderId: "demo-order-1",
    amountTinybars: "150000000", // 1.5 HBAR
    requesterAccountId: env.operatorId.toString(),
  };
  const unsignedLock = await adapter.buildFundLock(lockParams);
  const signedLock = (
    await Transaction.fromBytes(Buffer.from(unsignedLock.transactionBytes, "base64")).sign(
      env.operatorKey,
    )
  )
    .toBytes();
  const lockResult = await adapter.submitFundLock(
    lockParams,
    Buffer.from(signedLock).toString("base64"),
  );
  log("POSTED: fund lock (real, requester-signed)", lockResult);

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
