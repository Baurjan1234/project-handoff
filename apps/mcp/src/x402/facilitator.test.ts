import { describe, expect, it } from "vitest";
import { Facilitator, FacilitatorError, type FetchLike } from "./facilitator.js";
import type { PaymentPayload, PaymentRequirements } from "./types.js";

const TESTNET = "https://api.testnet.blocky402.com";

/** The shape their /supported actually returned on 2026-09-05, trimmed. */
const SUPPORTED = {
  kinds: [
    { x402Version: 2, scheme: "exact", network: "eip155:80002" },
    { x402Version: 2, scheme: "exact", network: "hedera:testnet", extra: { feePayer: "0.0.7162784" } },
  ],
  signers: { "hedera:*": ["0.0.7162784"] },
};

const REQUIREMENTS: PaymentRequirements = {
  scheme: "exact",
  network: "hedera:testnet",
  amount: "100000",
  payTo: "0.0.10376656",
  maxTimeoutSeconds: 300,
  asset: "0.0.0",
  extra: { feePayer: "0.0.7162784" },
};

const PAYLOAD: PaymentPayload = {
  x402Version: 2,
  scheme: "exact",
  network: "hedera:testnet",
  accepted: REQUIREMENTS,
  payload: { transaction: "AAAA" },
};

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function fakeFetch(responses: Record<string, unknown>, status = 200) {
  const calls: Call[] = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const body = responses[path];
    if (body === undefined) {
      return new Response("no route", { status: 404 });
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { impl, calls };
}

describe("Facilitator", () => {
  it("refuses to be pointed at mainnet", () => {
    expect(() => new Facilitator({ baseUrl: "https://api.blocky402.com" })).toThrow(
      FacilitatorError,
    );
    expect(() => new Facilitator({ baseUrl: "https://api.blocky402.com" })).toThrow(
      /testnet only/i,
    );
  });

  it("allows the hosted testnet endpoint and a local instance", () => {
    expect(() => new Facilitator({ baseUrl: TESTNET })).not.toThrow();
    expect(() => new Facilitator({ baseUrl: "http://localhost:3002" })).not.toThrow();
  });

  it("discovers the fee payer for our network rather than assuming one", async () => {
    const { impl } = fakeFetch({ "/supported": SUPPORTED });
    const facilitator = new Facilitator({ baseUrl: TESTNET, fetch: impl });

    await expect(facilitator.feePayer("hedera:testnet")).resolves.toBe("0.0.7162784");
  });

  it("falls back to the signers map when a kind carries no extra", async () => {
    const { impl } = fakeFetch({
      "/supported": {
        kinds: [{ x402Version: 2, scheme: "exact", network: "hedera:testnet" }],
        signers: { "hedera:*": ["0.0.7162784"] },
      },
    });
    const facilitator = new Facilitator({ baseUrl: TESTNET, fetch: impl });

    await expect(facilitator.feePayer("hedera:testnet")).resolves.toBe("0.0.7162784");
  });

  it("asks once and remembers, so a 402 does not depend on their uptime twice", async () => {
    const { impl, calls } = fakeFetch({ "/supported": SUPPORTED });
    const facilitator = new Facilitator({ baseUrl: TESTNET, fetch: impl });

    await facilitator.feePayer("hedera:testnet");
    await facilitator.feePayer("hedera:testnet");

    expect(calls).toHaveLength(1);
  });

  it("refuses to guess when no fee payer is advertised", async () => {
    const { impl } = fakeFetch({ "/supported": { kinds: [], signers: {} } });
    const facilitator = new Facilitator({ baseUrl: TESTNET, fetch: impl });

    await expect(facilitator.feePayer("hedera:testnet")).rejects.toThrow(/does not advertise/);
  });

  it("posts the canonical verify body", async () => {
    const { impl, calls } = fakeFetch({ "/verify": { isValid: true, payer: "0.0.10376659" } });
    const facilitator = new Facilitator({ baseUrl: TESTNET, fetch: impl });

    const verified = await facilitator.verify(PAYLOAD, REQUIREMENTS);

    expect(verified.isValid).toBe(true);
    expect(calls[0]?.url).toBe(`${TESTNET}/verify`);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      x402Version: 2,
      paymentPayload: PAYLOAD,
      paymentRequirements: REQUIREMENTS,
    });
  });

  it("returns the settlement receipt with its transaction id", async () => {
    const { impl } = fakeFetch({
      "/settle": {
        success: true,
        transaction: "0.0.7162784@1757000000.000000000",
        network: "hedera:testnet",
      },
    });
    const facilitator = new Facilitator({ baseUrl: TESTNET, fetch: impl });

    const receipt = await facilitator.settle(PAYLOAD, REQUIREMENTS);

    expect(receipt.transaction).toBe("0.0.7162784@1757000000.000000000");
  });

  it("surfaces a failing status rather than parsing the error as a result", async () => {
    const { impl } = fakeFetch({ "/verify": { isValid: true } }, 500);
    const facilitator = new Facilitator({ baseUrl: TESTNET, fetch: impl });

    await expect(facilitator.verify(PAYLOAD, REQUIREMENTS)).rejects.toThrow(/answered 500/);
  });
});
