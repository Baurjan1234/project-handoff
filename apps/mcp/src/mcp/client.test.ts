import { describe, expect, it } from "vitest";
import {
  postOrder,
  PaymentUnavailableError,
  UnwiredSigner,
  type OrderInput,
  type PaymentSigner,
} from "./client.js";
import {
  buildRequirements,
  encodePaymentRequired,
  paymentRequired,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  type GateConfig,
} from "../x402/gate.js";

const GATE_CONFIG: GateConfig = {
  network: "hedera:testnet",
  receiverAccountId: "0.0.10376656",
  feeTinybars: "100000",
};

const REQUIREMENTS = buildRequirements(GATE_CONFIG, "0.0.7162784");

const INPUT: OrderInput = {
  spec: "Review the attached report.",
  artifact: "FAKE report. Total 11,900.",
  certTag: "cpa-us",
  priceHbar: "200",
  deadline: "2026-09-14T00:00:00Z",
  claimTimeoutSeconds: 3600,
};

interface Call {
  readonly headers: Record<string, string>;
  readonly body: string;
}

/** 402 first, then whatever the second answer is told to be. */
function gatedService(second: { status: number; body: unknown }) {
  const calls: Call[] = [];
  const challenge = paymentRequired(REQUIREMENTS, "/orders");

  const fetchImpl = async (_url: string, init?: RequestInit): Promise<Response> => {
    calls.push({
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: String(init?.body ?? ""),
    });

    if (calls.length === 1) {
      return new Response(JSON.stringify(challenge), {
        status: 402,
        headers: { [PAYMENT_REQUIRED_HEADER]: encodePaymentRequired(challenge) },
      });
    }

    return new Response(JSON.stringify(second.body), { status: second.status });
  };

  return { fetchImpl, calls };
}

const stubSigner: PaymentSigner = { async sign() { return "SIGNED"; } };

describe("the handoff_verify client", () => {
  it("pays the price it was quoted and retries", async () => {
    const { fetchImpl, calls } = gatedService({
      status: 200,
      body: { order_id: "ord_1", transaction_ids: { service_fee: "0.0.1@2.3" } },
    });

    const result = await postOrder(INPUT, {
      baseUrl: "http://localhost:4021",
      signer: stubSigner,
      fetch: fetchImpl,
    });

    expect(result["order_id"]).toBe("ord_1");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.headers[PAYMENT_SIGNATURE_HEADER]).toBeUndefined();
    expect(calls[1]?.headers[PAYMENT_SIGNATURE_HEADER]).toBe("SIGNED");
    // The order itself is unchanged between the unpaid and paid attempts.
    expect(calls[0]?.body).toBe(calls[1]?.body);
  });

  it("signs the requirements it was quoted, not requirements of its own", async () => {
    const seen: unknown[] = [];
    const { fetchImpl } = gatedService({ status: 200, body: { order_id: "ord_1" } });

    await postOrder(INPUT, {
      baseUrl: "http://localhost:4021",
      signer: {
        async sign(requirements) {
          seen.push(requirements);
          return "SIGNED";
        },
      },
      fetch: fetchImpl,
    });

    // Anything else earns accepted_payment_requirements_mismatch from the
    // facilitator, before it ever looks at the transaction.
    expect(seen[0]).toEqual(REQUIREMENTS);
  });

  it("sends the artifact as bytes and never as a hash of its own making", async () => {
    const { fetchImpl, calls } = gatedService({ status: 200, body: { order_id: "ord_1" } });

    await postOrder(INPUT, {
      baseUrl: "http://localhost:4021",
      signer: stubSigner,
      fetch: fetchImpl,
    });

    const sent = JSON.parse(calls[0]?.body ?? "{}") as Record<string, string>;
    expect(Buffer.from(sent["artifact_base64"] ?? "", "base64").toString("utf8")).toBe(
      INPUT.artifact,
    );
    expect(sent["class"]).toBe("review");
  });

  it("reports the price when there is no way to pay it", async () => {
    const { fetchImpl, calls } = gatedService({ status: 200, body: {} });

    const failure = await postOrder(INPUT, {
      baseUrl: "http://localhost:4021",
      signer: new UnwiredSigner(),
      fetch: fetchImpl,
    }).catch((error: unknown) => error as Error);

    expect(failure).toBeInstanceOf(PaymentUnavailableError);
    // The agent is told what it would have cost, so this is actionable.
    expect(failure.message).toMatch(/100000 tinybars to 0\.0\.10376656/);
    // And it stopped at the challenge rather than retrying blind.
    expect(calls).toHaveLength(1);
  });

  it("surfaces a rejected payment as the facilitator's reason", async () => {
    const { fetchImpl } = gatedService({
      status: 402,
      body: { ...paymentRequired(REQUIREMENTS, "/orders", "InvalidSignature") },
    });

    await expect(
      postOrder(INPUT, {
        baseUrl: "http://localhost:4021",
        signer: stubSigner,
        fetch: fetchImpl,
      }),
    ).rejects.toThrow(/InvalidSignature/);
  });
});
