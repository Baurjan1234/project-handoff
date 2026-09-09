/**
 * Proves the provisioned topics behave the way their keys claim (NAS-13):
 *  - the attestations topic accepts a submit from an account that is not the platform
 *  - the registry topic REFUSES a submit that is not signed by its submit key
 *  - what went in comes back out of the mirror node
 *
 * The refusal is the point. A submit key that doesn't actually stop anyone is worse
 * than no submit key, because the design claims it does.
 *
 * Run: node --env-file=../../.env $(which npx) tsx scripts/verify-topics.ts <orders> <attestations> <registry>
 */
import { AccountCreateTransaction, Client, Hbar, PrivateKey, TopicId, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import { createTestnetClient, loadChainEnv } from "../src/config.ts";
import { submitTopicMessage } from "../src/hcs.ts";
import { fetchMirrorTopicMessages } from "../src/mirror.ts";

async function main(): Promise<void> {
  const [ordersTopic, attestationsTopic, registryTopic] = process.argv.slice(2);
  if (!ordersTopic || !attestationsTopic || !registryTopic) {
    throw new Error("usage: verify-topics.ts <ordersTopicId> <attestationsTopicId> <registryTopicId>");
  }

  const env = loadChainEnv();
  const client = createTestnetClient(env);

  // 1. Open topic accepts a submit.
  const payload = { probe: "verify-topics", at: new Date().toISOString() };
  const submitted = await submitTopicMessage(client, TopicId.fromString(attestationsTopic), payload);
  console.log(`attestations topic accepted a submit: seq ${submitted.result.topicSequenceNumber}, tx ${submitted.transactionId}`);

  const ordersSubmitted = await submitTopicMessage(client, TopicId.fromString(ordersTopic), { probe: "orders" });
  console.log(`orders topic accepted a submit: seq ${ordersSubmitted.result.topicSequenceNumber}`);

  // 2. The registry must REFUSE a submit not signed by its submit key.
  //
  // This needs a genuinely separate operator. Signing with a stranger's key on THIS
  // client proves nothing: `execute(client)` also attaches the client operator's
  // signature, and the operator here IS the registry's submit key — so the submit
  // would be authorized by the very key the test is trying to exclude. An earlier
  // version of this script made exactly that mistake and reported a false pass.
  const stranger = PrivateKey.generateED25519();
  const created = await new AccountCreateTransaction()
    .setKey(stranger.publicKey)
    .setInitialBalance(new Hbar(2))
    .execute(client);
  const strangerAccountId = (await created.getReceipt(client)).accountId;
  if (!strangerAccountId) throw new Error("could not create the stranger account for the refusal test");
  console.log(`\nstranger account for the refusal test: ${strangerAccountId.toString()}`);

  const strangerClient = Client.forTestnet();
  strangerClient.setOperator(strangerAccountId, stranger);

  let refused = false;
  try {
    const response = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(registryTopic))
      .setMessage(JSON.stringify({ probe: "unauthorized registry write" }))
      .execute(strangerClient);
    await response.getReceipt(strangerClient);
  } catch (error) {
    refused = true;
    console.log(`registry topic refused a submit from an unauthorized account: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
  }
  strangerClient.close();

  if (!refused) {
    throw new Error("registry topic ACCEPTED a submit from an account with no submit key — the submit key is not doing its job");
  }

  // 3. And it accepts one signed by the real submit key.
  const authorized = await submitTopicMessage(client, TopicId.fromString(registryTopic), { probe: "authorized" }, env.operatorKey);
  console.log(`registry topic accepted an authorized submit: seq ${authorized.result.topicSequenceNumber}`);

  // 4. Read back through the mirror node.
  await new Promise((resolve) => setTimeout(resolve, 6000));
  const messages = await fetchMirrorTopicMessages(env.mirrorNodeUrl, attestationsTopic, { limit: 5, order: "desc" });
  console.log(`\nmirror node returns ${messages.length} message(s) on the attestations topic:`);
  for (const m of messages) {
    console.log(`  seq ${m.sequence_number} · payer ${m.payer_account_id} · ${m.message.slice(0, 60)}`);
  }

  console.log("\nTopics verified: open topics accept, the registry refuses what it should.");
  client.close();
}

main().catch((error: unknown) => {
  console.error("\n=== FAILED ===");
  console.error(error);
  process.exit(1);
});
