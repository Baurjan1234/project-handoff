import { describe, expect, it } from "vitest";
import { Facilitator, type FetchLike } from "./facilitator.js";
import {
  buildRequirements,
  decodePaymentSignature,
  gate,
  headerLookup,
  settle,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  type GateConfig,
} from "./gate.js";
import type { PaymentPayload, PaymentRequired } from "./types.js";

const TESTNET = "https://api.testnet.blocky402.com";

const CONFIG: GateConfig = {
  network: "hedera:testnet",
  receiverAccountId: "0.0.10376656",
  feeTinybars: "100000",
  serviceUrl: "http://localhost:4021",
};

const SUPPORTED = {
  kinds: [{ x402Version: 2, scheme: "exact", network: "hedera:testnet", extra: { feePayer: "0.0.7162784" } }],
  signers: { "hedera:*": ["0.0.7162784"] },
};

function harness(verifyResponse: unknown = { isValid: true, payer: "0.0.10376659" }) {
  const paths: string[] = [];
  const impl: FetchLike = async (url) => {
    const path = new URL(url).pathname;
    paths.push(path);
    const bodies: Record<string, unknown> = {
      "/supported": SUPPORTED,
      "/verify": verifyResponse,
      "/settle": {
        success: true,
        transaction: "0.0.7162784@1757000000.000000000",
        network: "hedera:testnet",
      },
    };
    return new Response(JSON.stringify(bodies[path] ?? {}), { status: 200 });
  };

  const facilitator = new Facilitator({ baseUrl: TESTNET, fetch: impl });
  return { deps: { facilitator, config: CONFIG }, paths };
}

/**
 * The envelope our own `X402Signer` produces, captured rather than recalled.
 *
 * Four top-level keys — `x402Version`, `resource`, `accepted`, `payload` — and
 * no `scheme` or `network` outside `accepted`. Captured 2026-09-08 by signing
 * a quote offline with `@x402/hedera` 2.25.0 and decoding the resulting
 * `PAYMENT-SIGNATURE` value; the transaction bytes are elided because only the
 * envelope is this file's business.
 */
function paymentHeader(overrides: Partial<PaymentPayload> = {}): string {
  const payload: PaymentPayload = {
    x402Version: 2,
    resource: { url: "http://localhost:4021/orders" },
    accepted: buildRequirements(CONFIG, "0.0.7162784"),
    payload: { transaction: "AAAA" },
    ...overrides,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

function decodeRequiredHeader(header: string): PaymentRequired {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as PaymentRequired;
}

describe("buildRequirements", () => {
  it("prices the call in HBAR, which needs no token association", () => {
    const requirements = buildRequirements(CONFIG, "0.0.7162784");

    expect(requirements.asset).toBe("0.0.0");
    expect(requirements.amount).toBe("100000");
    expect(requirements.payTo).toBe("0.0.10376656");
    expect(requirements.extra.feePayer).toBe("0.0.7162784");
    expect(requirements.network).toBe("hedera:testnet");
  });

  it("refuses a fee that is not a whole positive number of tinybars", () => {
    expect(() => buildRequirements({ ...CONFIG, feeTinybars: "0" }, "0.0.7162784")).toThrow();
    expect(() => buildRequirements({ ...CONFIG, feeTinybars: "0.5" }, "0.0.7162784")).toThrow();
    expect(() => buildRequirements({ ...CONFIG, feeTinybars: "-1" }, "0.0.7162784")).toThrow();
  });
});

describe("gate", () => {
  it("answers 402 with the price when nothing was paid", async () => {
    const { deps, paths } = harness();

    const outcome = await gate(headerLookup({}), "/orders", deps);

    expect(outcome.kind).toBe("payment-required");
    if (outcome.kind !== "payment-required") return;

    expect(outcome.status).toBe(402);
    const declared = decodeRequiredHeader(outcome.headers[PAYMENT_REQUIRED_HEADER] ?? "");
    expect(declared).toEqual(outcome.body);
    expect(declared.x402Version).toBe(2);
    expect(declared.accepts[0]?.payTo).toBe("0.0.10376656");
    expect(declared.resource).toEqual({ url: "http://localhost:4021/orders" });
    // Nothing was offered, so there is nothing to verify.
    expect(paths).not.toContain("/verify");
  });

  it("serves when the facilitator says the payment is valid", async () => {
    const { deps } = harness();

    const outcome = await gate(
      headerLookup({ [PAYMENT_SIGNATURE_HEADER]: paymentHeader() }),
      "/orders",
      deps,
    );

    expect(outcome.kind).toBe("paid");
    if (outcome.kind !== "paid") return;
    expect(outcome.payer).toBe("0.0.10376659");
  });

  it("finds the header whatever case it arrives in", async () => {
    const { deps } = harness();

    const outcome = await gate(
      headerLookup({ "payment-signature": paymentHeader() }),
      "/orders",
      deps,
    );

    expect(outcome.kind).toBe("paid");
  });

  it("still reads the version 1 header rather than ignoring an older client", async () => {
    const { deps } = harness();

    const outcome = await gate(headerLookup({ "X-PAYMENT": paymentHeader() }), "/orders", deps);

    expect(outcome.kind).toBe("paid");
  });

  it("returns the facilitator's reason on the next challenge", async () => {
    const { deps } = harness({
      isValid: false,
      invalidReason: "InvalidSignature",
      invalidMessage: "Signature recovery did not match the expected payer",
    });

    const outcome = await gate(
      headerLookup({ [PAYMENT_SIGNATURE_HEADER]: paymentHeader() }),
      "/orders",
      deps,
    );

    expect(outcome.kind).toBe("payment-required");
    if (outcome.kind !== "payment-required") return;
    expect(outcome.body.error).toBe("InvalidSignature");
    // The price is still stated, so a client that can fix it can pay again.
    expect(outcome.body.accepts[0]?.amount).toBe("100000");
  });

  it("rejects a payment for another network without asking the facilitator", async () => {
    const { deps, paths } = harness();

    const outcome = await gate(
      headerLookup({
        [PAYMENT_SIGNATURE_HEADER]: paymentHeader({
          // In `accepted`, because version 2 has no top-level network.
          accepted: { ...buildRequirements(CONFIG, "0.0.7162784"), network: "eip155:80002" as never },
        }),
      }),
      "/orders",
      deps,
    );

    expect(outcome.kind).toBe("payment-required");
    if (outcome.kind !== "payment-required") return;
    expect(outcome.body.error).toMatch(/eip155:80002/);
    expect(paths).not.toContain("/verify");
  });

  it("treats an unreadable header as unpaid rather than as a crash", async () => {
    const { deps } = harness();

    const outcome = await gate(
      headerLookup({ [PAYMENT_SIGNATURE_HEADER]: "not base64 json" }),
      "/orders",
      deps,
    );

    expect(outcome.kind).toBe("payment-required");
    if (outcome.kind !== "payment-required") return;
    expect(outcome.body.error).toMatch(/base64|x402 payload/);
  });
});

describe("settle", () => {
  it("carries the Hedera transaction id back in the receipt header", async () => {
    const { deps } = harness();
    const outcome = await gate(
      headerLookup({ [PAYMENT_SIGNATURE_HEADER]: paymentHeader() }),
      "/orders",
      deps,
    );
    if (outcome.kind !== "paid") throw new Error("expected a paid outcome");

    const settled = await settle(outcome, deps);

    expect(settled.receipt.transaction).toBe("0.0.7162784@1757000000.000000000");
    const header = settled.headers[PAYMENT_RESPONSE_HEADER] ?? "";
    expect(JSON.parse(Buffer.from(header, "base64").toString("utf8"))).toEqual(settled.receipt);
  });
});

describe("decodePaymentSignature", () => {
  function encode(value: unknown): string {
    return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
  }

  it("accepts the envelope our own signer emits", () => {
    const decoded = decodePaymentSignature(paymentHeader());

    // The round trip this service exists to serve. It failed before: the
    // decoder required `scheme` and `network` at the top level, which is the
    // version 1 shape, so our own payment was refused before the facilitator
    // ever saw it.
    expect(decoded.accepted.scheme).toBe("exact");
    expect(decoded.accepted.network).toBe("hedera:testnet");
    expect(decoded.payload.transaction).toBe("AAAA");
    expect(decoded.resource?.url).toBe("http://localhost:4021/orders");
  });

  it("rejects a payload that is not the exact scheme", () => {
    const header = encode({
      x402Version: 2,
      accepted: { ...buildRequirements(CONFIG, "0.0.7162784"), scheme: "upto" },
      payload: { transaction: "AAAA" },
    });

    expect(() => decodePaymentSignature(header)).toThrow(/exact-scheme/);
  });

  it("names version 1 rather than calling it unrecognisable", () => {
    const header = encode({
      x402Version: 1,
      scheme: "exact",
      network: "hedera:testnet",
      payload: { transaction: "AAAA" },
    });

    expect(() => decodePaymentSignature(header)).toThrow(/version 1/);
  });

  it("rejects a payload with no transaction in it", () => {
    const header = encode({
      x402Version: 2,
      accepted: buildRequirements(CONFIG, "0.0.7162784"),
      payload: {},
    });

    expect(() => decodePaymentSignature(header)).toThrow(/exact-scheme/);
  });
});

describe("the 402 names its resource", () => {
  it("states an absolute URL, which is what a version 2 client requires", async () => {
    const { deps } = harness();

    const outcome = await gate(headerLookup({}), "/orders", deps);

    expect(outcome.kind).toBe("payment-required");
    if (outcome.kind !== "payment-required") return;
    // An object with a URL, never the bare path. `PaymentRequiredV2Schema` in
    // `@x402/core` types `resource` as an object and requires it, so a string
    // here is rejected by any version 2 client before it builds a payment.
    expect(outcome.body.resource).toEqual({ url: "http://localhost:4021/orders" });
  });

  it("refuses to start a challenge it cannot address", async () => {
    const { deps } = harness();
    const broken = { ...deps, config: { ...CONFIG, serviceUrl: "not a url" } };

    await expect(gate(headerLookup({}), "/orders", broken)).rejects.toThrow(
      /HANDOFF_SERVICE_URL/,
    );
  });
});
