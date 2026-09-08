/**
 * NAS-5: empirical confirmation of schedule-at-claim on real testnet.
 *
 * docs/research/hedera-primitives-verified.md already concluded this from Hedera's
 * documentation; this script is the "done when: a testnet run confirms it" half.
 * Run with: node --env-file=../../.env packages/chain/scripts/confirm-schedule-at-claim.ts
 * (from the repo root), or `node packages/chain/scripts/confirm-schedule-at-claim.ts`
 * from inside packages/chain with the env already exported.
 *
 * Uses one funded testnet account as BOTH the operator and the escrow's "requester"
 * role — two throwaway keys (generated locally, no separate funded account needed)
 * fill the verifier and schedule-admin roles. That's enough to exercise the real
 * 2-of-3 threshold mechanics without needing three funded accounts.
 */
import { PrivateKey } from "@hiero-ledger/sdk";
import {
  buildEscrowKeyList,
  createClaimSchedule,
  createEscrowAccount,
  createTestnetClient,
  fetchMirrorSchedule,
  fetchMirrorTransaction,
  loadChainEnv,
  signScheduleForEarlyExecute,
} from "../src/index.ts";

function log(step: string, detail: unknown): void {
  console.log(`\n=== ${step} ===`);
  console.log(JSON.stringify(detail, null, 2));
}

async function main(): Promise<void> {
  const env = loadChainEnv();
  const client = createTestnetClient(env);

  const verifierKey = PrivateKey.generateECDSA();
  const scheduleAdminKey = PrivateKey.generateECDSA();

  log("setup", {
    operator: env.operatorId.toString(),
    verifierPublicKey: verifierKey.publicKey.toString(),
    scheduleAdminPublicKey: scheduleAdminKey.publicKey.toString(),
  });

  // 1. Escrow account: 2-of-3 KeyList (operator = requester role, + verifier + admin).
  const keyList = buildEscrowKeyList({
    requester: env.operatorKey.publicKey,
    verifier: verifierKey.publicKey,
    scheduleAdmin: scheduleAdminKey.publicKey,
  });

  const escrow = await createEscrowAccount(client, keyList, "5");
  log("escrow account created", { transactionId: escrow.transactionId, accountId: escrow.result.accountId.toString() });

  // 2. "Claim" simulation: create the schedule now that the payee is known —
  // the payee here is the operator's own account, which is fine for confirming the
  // mechanics (schedule-at-claim doesn't care who the payee is, only that they're
  // known at creation time).
  const expirationTime = new Date(Date.now() + 5 * 60_000);
  const scheduleCreate = await createClaimSchedule(client, {
    escrowAccountId: escrow.result.accountId,
    payeeAccountId: env.operatorId,
    amountTinybars: "100000000", // 1 HBAR
    scheduleAdminKey,
    memo: "NAS-5 confirmation",
    expirationTime,
  });
  log("schedule created", {
    transactionId: scheduleCreate.transactionId,
    scheduleId: scheduleCreate.result.scheduleId.toString(),
    alreadyExisted: scheduleCreate.result.alreadyExisted,
  });

  // Check whether creating the schedule already satisfied the threshold (operator's
  // signature on ScheduleCreate can count toward the inner transfer's requirement,
  // since operator is one of the escrow's 3 KeyList members).
  const afterCreate = await fetchMirrorSchedule(env.mirrorNodeUrl, scheduleCreate.result.scheduleId.toString());
  log("schedule state after creation, before any ScheduleSign", afterCreate);

  // 3. Early-execute: one more signature (verifier) should complete the 2-of-3
  // threshold, since operator's implicit signature already counts as one.
  const sign = await signScheduleForEarlyExecute(client, scheduleCreate.result.scheduleId, verifierKey);
  log("verifier signed", { transactionId: sign.transactionId });

  await new Promise((resolve) => setTimeout(resolve, 6000)); // mirror-node indexing delay, verified in research doc

  const afterSign = await fetchMirrorSchedule(env.mirrorNodeUrl, scheduleCreate.result.scheduleId.toString());
  log("schedule state after one additional ScheduleSign", afterSign);

  if (afterSign?.executed_timestamp) {
    const tx = await fetchMirrorTransaction(env.mirrorNodeUrl, sign.transactionId);
    log("CONFIRMED: schedule executed early (waitForExpiry=false is early-execute)", tx);
  } else {
    log("NOT YET EXECUTED — waitForExpiry(false) did not early-execute as expected", afterSign);
  }

  // 4. Idempotency: creating an identical schedule again should return the SAME
  // scheduleId with alreadyExisted: true, not fail or create a second one.
  const duplicate = await createClaimSchedule(client, {
    escrowAccountId: escrow.result.accountId,
    payeeAccountId: env.operatorId,
    amountTinybars: "100000000",
    scheduleAdminKey,
    memo: "NAS-5 confirmation",
    expirationTime,
  });
  log("duplicate createClaimSchedule call (same params)", {
    scheduleId: duplicate.result.scheduleId.toString(),
    alreadyExisted: duplicate.result.alreadyExisted,
    matchesOriginal: duplicate.result.scheduleId.toString() === scheduleCreate.result.scheduleId.toString(),
  });

  client.close();
}

main().catch((error: unknown) => {
  console.error("\n=== SCRIPT FAILED ===");
  console.error(error);
  process.exit(1);
});
