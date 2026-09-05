import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { MockChainAdapter } from "@handoff/schema";
import { InMemoryContentStore } from "./content.js";
import { createHttpServer, MAX_BODY_BYTES } from "./http.js";
import { Facilitator, type FetchLike } from "./x402/facilitator.js";
import { PAYMENT_REQUIRED_HEADER, type GateConfig } from "./x402/gate.js";
import type { ServerDeps } from "./server.js";

const GATE_CONFIG: GateConfig = {
  network: "hedera:testnet",
  receiverAccountId: "0.0.10376656",
  feeTinybars: "100000",
};

const fetchStub: FetchLike = async (url) =>
  new Response(
    JSON.stringify(
      new URL(url).pathname === "/supported"
        ? {
            kinds: [
              {
                x402Version: 2,
                scheme: "exact",
                network: "hedera:testnet",
                extra: { feePayer: "0.0.7162784" },
              },
            ],
          }
        : {},
    ),
  );

const deps: ServerDeps = {
  facilitator: new Facilitator({ baseUrl: "https://api.testnet.blocky402.com", fetch: fetchStub }),
  gateConfig: GATE_CONFIG,
  chain: new MockChainAdapter(),
  content: new InMemoryContentStore(),
  ordersTopicId: "0.0.orders",
  requesterAccountId: "0.0.10376659",
};

let server: Server;
let origin: string;

beforeAll(async () => {
  server = createHttpServer(deps);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("the socket layer", () => {
  it("serves a real 402 over HTTP, header and body agreeing", async () => {
    const response = await fetch(`${origin}/orders`, { method: "POST", body: "{}" });

    expect(response.status).toBe(402);
    const header = response.headers.get(PAYMENT_REQUIRED_HEADER.toLowerCase());
    expect(header).toBeTruthy();
    expect(JSON.parse(Buffer.from(header ?? "", "base64").toString("utf8"))).toEqual(
      await response.json(),
    );
  });

  it("serves health", async () => {
    const response = await fetch(`${origin}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", network: "hedera:testnet" });
  });

  it("refuses a body that would hold the process's memory", async () => {
    const response = await fetch(`${origin}/orders`, {
      method: "POST",
      body: "x".repeat(MAX_BODY_BYTES + 1024),
    });

    expect(response.status).toBe(413);
  });
});
