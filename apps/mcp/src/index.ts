/**
 * The resource server process.
 *
 * Composition root: this is the one place that decides which adapter, which
 * store and which facilitator the handler gets. Everything below it takes its
 * dependencies as arguments, which is what makes the Monday cutover a change
 * here rather than a change everywhere.
 */

import { MockChainAdapter, type ChainAdapter } from "@handoff/schema";
import { configFromEnv } from "./config.js";
import { InMemoryContentStore } from "./content.js";
import { createHttpServer } from "./http.js";
import { Facilitator } from "./x402/facilitator.js";

function chainFromEnv(): ChainAdapter {
  const mode = process.env["HANDOFF_CHAIN"]?.trim() ?? "mock";

  if (mode === "mock") {
    // Loud on purpose. Mock transaction ids look like MOCK-tx-1 and 404 on
    // Hashscan, and the one failure this project cannot afford is one of them
    // reaching a recording unnoticed.
    console.warn(
      "\n  MOCK CHAIN. Transaction ids are fabricated and 404 on Hashscan.\n" +
        "  Never record this. Set HANDOFF_CHAIN=testnet after the cutover.\n",
    );
    return new MockChainAdapter();
  }

  // The real adapter lands with packages/chain at the cutover, Mon Sep 7.
  // Failing here beats starting a process that silently posts nowhere.
  throw new Error(
    `HANDOFF_CHAIN=${mode} is not wired yet. The real adapter arrives with ` +
      `@handoff/chain at the cutover; until then the only value is "mock".`,
  );
}

function main(): void {
  const config = configFromEnv();

  const server = createHttpServer(
    {
      facilitator: new Facilitator({ baseUrl: config.facilitatorUrl }),
      gateConfig: {
        network: config.network,
        receiverAccountId: config.receiverAccountId,
        feeTinybars: config.feeTinybars,
      },
      chain: chainFromEnv(),
      content: new InMemoryContentStore(),
      ordersTopicId: config.ordersTopicId,
      requesterAccountId: config.requesterAccountId,
    },
    { log: (line) => console.log(line) },
  );

  server.listen(config.port, () => {
    console.log(`handoff resource server on :${config.port}`);
    console.log(`  facilitator  ${config.facilitatorUrl} (${config.network})`);
    console.log(`  fee          ${config.feeTinybars} tinybars to ${config.receiverAccountId}`);
    console.log(`  orders topic ${config.ordersTopicId}`);
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
    });
  }
}

main();
