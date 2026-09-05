import { describe, expect, it } from "vitest";
import { MockChainAdapter } from "@handoff/schema";
import { InMemoryContentStore } from "./content.js";
import { handle, type HttpRequest, type ServerDeps } from "./server.js";
import { Facilitator, type FetchLike } from "./x402/facilitator.js";
import {
  buildRequirements,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  type GateConfig,
} from "./x402/gate.js";
import type { PaymentPayload } from "./x402/types.js";

const GATE_CONFIG: GateConfig = {
  network: "hedera:testnet",
  receiverAccountId: "0.0.10376656",
  feeTinybars: "100000",
};

const SETTLE_TX = "0.0.7162784@1757000000.000000000";

function harness(options: { verify?: unknown; settle?: unknown } = {}) {
  const paths: string[] = [];
  const impl: FetchLike = async (url) => {
    const path = new URL(url).pathname;
    paths.push(path);
    const bodies: Record<string, unknown> = {
      "/supported": {
        kinds: [
          {
            x402Version: 2,
            scheme: "exact",
            network: "hedera:testnet",
            extra: { feePayer: "0.0.7162784" },
          },
        ],
      },
      "/verify": options.verify ?? { isValid: true, payer: "0.0.10376659" },
      "/settle": options.settle ?? {
        success: true,
        transaction: SETTLE_TX,
        network: "hedera:testnet",
      },
    };
    return new Response(JSON.stringify(bodies[path] ?? {}), { status: 200 });
  };

  const content = new InMemoryContentStore();
  const deps: ServerDeps = {
    facilitator: new Facilitator({ baseUrl: "https://api.testnet.blocky402.com", fetch: impl }),
    gateConfig: GATE_CONFIG,
    chain: new MockChainAdapter(),
    content,
    ordersTopicId: "0.0.orders",
    requesterAccountId: "0.0.10376659",
  };
  return { deps, paths, content };
}

function paidHeader(): string {
  const payload: PaymentPayload = {
    x402Version: 2,
    scheme: "exact",
    network: "hedera:testnet",
    accepted: buildRequirements(GATE_CONFIG, "0.0.7162784"),
    payload: { transaction: "AAAA" },
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

function orderBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    spec: "Review the attached report for arithmetic defects.",
    artifact_base64: Buffer.from("FAKE report. Total 11,900.").toString("base64"),
    cert_tag: "cpa-us",
    price_hbar: "200",
    // Far enough out that a one-hour claim timeout is inside the allowed third.
    deadline: futureUtc(60 * 60 * 24 * 7),
    claim_timeout_seconds: 3600,
    ...overrides,
  });
}

function futureUtc(seconds: number): string {
  return `${new Date(Date.now() + seconds * 1000).toISOString().slice(0, 19)}Z`;
}

function post(headers: Record<string, string | undefined>, body: string): HttpRequest {
  return { method: "POST", path: "/orders", headers, body };
}

describe("POST /orders", () => {
  it("charges before it does anything else", async () => {
    const { deps, paths, content } = harness();

    const response = await handle(post({}, orderBody()), deps);

    expect(response.status).toBe(402);
    expect(response.headers[PAYMENT_REQUIRED_HEADER]).toBeTruthy();
    // No order was posted and no content was stored for an unpaid call.
    expect(content.size).toBe(0);
    expect(paths).not.toContain("/settle");
  });

  it("posts the order and settles the fee once the payment verifies", async () => {
    const { deps, paths } = harness();

    const response = await handle(
      post({ [PAYMENT_SIGNATURE_HEADER]: paidHeader() }, orderBody()),
      deps,
    );

    expect(response.status).toBe(200);
    expect(paths).toEqual(["/supported", "/verify", "/settle"]);

    const body = response.body as Record<string, Record<string, string>>;
    expect(body["order_id"]).toMatch(/^ord_/);
    expect(body["transaction_ids"]?.["lock_funds"]).toBeTruthy();
    expect(body["transaction_ids"]?.["submit_envelope"]).toBeTruthy();
    expect(body["transaction_ids"]?.["service_fee"]).toBe(SETTLE_TX);
    expect(response.headers[PAYMENT_RESPONSE_HEADER]).toBeTruthy();
  });

  it("settles only after the order is posted, so a bad order costs the caller nothing", async () => {
    const { deps, paths } = harness();

    const response = await handle(
      post({ [PAYMENT_SIGNATURE_HEADER]: paidHeader() }, orderBody({ price_hbar: "not-a-price" })),
      deps,
    );

    expect(response.status).toBe(400);
    // Verified, never settled: the payment was proven, not submitted.
    expect(paths).toContain("/verify");
    expect(paths).not.toContain("/settle");
  });

  it("does not settle when the order fails to post", async () => {
    const { deps, paths } = harness();
    const chain = {
      ...deps.chain,
      network: "testnet" as const,
      lockFunds: async () => {
        throw new Error("escrow unreachable");
      },
    };

    const response = await handle(
      post({ [PAYMENT_SIGNATURE_HEADER]: paidHeader() }, orderBody()),
      { ...deps, chain },
    );

    expect(response.status).toBe(502);
    expect(paths).toContain("/verify");
    expect(paths).not.toContain("/settle");
  });

  it("refuses to sell an execution order", async () => {
    const { deps } = harness();

    const response = await handle(
      post({ [PAYMENT_SIGNATURE_HEADER]: paidHeader() }, orderBody({ class: "execution" })),
      deps,
    );

    expect(response.status).toBe(400);
  });

  it("keeps the two money flows apart in what it reports", async () => {
    const { deps } = harness();

    const response = await handle(
      post({ [PAYMENT_SIGNATURE_HEADER]: paidHeader() }, orderBody()),
      deps,
    );

    const body = response.body as Record<string, Record<string, unknown>>;
    // The service fee is the facilitator's transaction; the order value went
    // to an escrow. Different rails, and the response says which is which.
    expect(body["service_fee"]?.["settled"]).toBe(true);
    expect(body["escrow_account_id"]).toBeTruthy();
    expect(body["transaction_ids"]?.["service_fee"]).not.toBe(
      body["transaction_ids"]?.["lock_funds"],
    );
  });

  it("reports a failed settlement instead of pretending the fee moved", async () => {
    const { deps } = harness({
      settle: {
        success: false,
        transaction: "",
        network: "hedera:testnet",
        errorReason: "transaction_failed",
      },
    });

    const response = await handle(
      post({ [PAYMENT_SIGNATURE_HEADER]: paidHeader() }, orderBody()),
      deps,
    );

    expect(response.status).toBe(200);
    const body = response.body as Record<string, Record<string, unknown>>;
    expect(body["service_fee"]?.["settled"]).toBe(false);
    expect(body["service_fee"]?.["error"]).toBe("transaction_failed");
  });

  it("answers anything else without touching the facilitator", async () => {
    const { deps, paths } = harness();

    expect((await handle({ ...post({}, ""), path: "/health" }, deps)).status).toBe(404);
    expect((await handle({ ...post({}, ""), method: "GET" }, deps)).status).toBe(405);
    expect(paths).toEqual([]);
  });
});
