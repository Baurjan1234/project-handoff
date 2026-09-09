/**
 * Creates the HCS topics the rest of the repo needs (NAS-13) and prints their ids.
 *
 * Run once. Running it again creates NEW topics — the ids are the output, so record
 * them in .env rather than re-running and wondering why the app reads an empty topic.
 *
 * Run: node --env-file=../../.env $(which npx) tsx scripts/provision-topics.ts
 *
 * Submit keys differ per topic, verified in
 * ../../docs/research/hedera-primitives-verified.md:
 *
 *   orders, attestations  NO submit key — experts publish claims and attestations
 *                         from their OWN accounts, and a submit key would put the
 *                         platform in the signing path, which is the whole point of
 *                         the design being wrong.
 *   registry              submit key SET — only the platform adds, removes, or
 *                         grants a cert tag.
 *
 * Admin keys: deliberately NOT set on orders and attestations. An admin key would let
 * the platform delete the topic, and "attributable forever, permanent" is a claim this
 * product makes out loud — a record the platform can erase is a weaker claim than one
 * it cannot. The registry gets one, because that topic is platform-managed by design
 * and needs to stay maintainable. Say this out loud if a judge asks what stops us
 * from rewriting history: nothing can, on the two topics that matter.
 */
import { createTestnetClient, loadChainEnv } from "../src/config.ts";
import { createTopic } from "../src/hcs.ts";

async function main(): Promise<void> {
  const env = loadChainEnv();
  const client = createTestnetClient(env);

  const orders = await createTopic(client, {
    memo: "handoff: orders and claims (public, no submit key)",
  });
  console.log(`\nHANDOFF_ORDERS_TOPIC_ID=${orders.result.topicId.toString()}`);
  console.log(`  tx: ${orders.transactionId}`);

  const attestations = await createTopic(client, {
    memo: "handoff: attestations (public, no submit key, experts sign from their own accounts)",
  });
  console.log(`\nHANDOFF_ATTESTATIONS_TOPIC_ID=${attestations.result.topicId.toString()}`);
  console.log(`  tx: ${attestations.transactionId}`);

  // The registry is platform-written, so it gets both keys. Operator key stands in for
  // the platform key here; swap for the vault-held one when the registry lands (NAS-27).
  const registry = await createTopic(client, {
    memo: "handoff: cert registry (platform-written, submit key set)",
    adminKey: env.operatorKey,
    submitKey: env.operatorKey,
  });
  console.log(`\nHANDOFF_REGISTRY_TOPIC_ID=${registry.result.topicId.toString()}`);
  console.log(`  tx: ${registry.transactionId}`);

  console.log(`\n--- paste into .env (and VITE_HANDOFF_ORDERS_TOPIC_ID for apps/web) ---`);
  console.log(`HANDOFF_ORDERS_TOPIC_ID=${orders.result.topicId.toString()}`);
  console.log(`HANDOFF_ATTESTATIONS_TOPIC_ID=${attestations.result.topicId.toString()}`);
  console.log(`HANDOFF_REGISTRY_TOPIC_ID=${registry.result.topicId.toString()}`);

  console.log(`\nHashscan:`);
  for (const [name, id] of [
    ["orders", orders.result.topicId.toString()],
    ["attestations", attestations.result.topicId.toString()],
    ["registry", registry.result.topicId.toString()],
  ]) {
    console.log(`  ${name}: https://hashscan.io/testnet/topic/${id}`);
  }

  client.close();
}

main().catch((error: unknown) => {
  console.error("\n=== FAILED ===");
  console.error(error);
  process.exit(1);
});
