/**
 * The payment gate.
 *
 * A call arrives with no payment, so we answer 402 and say what it costs. It
 * comes back with a signed transfer in a header, we ask the facilitator, and
 * on a valid answer the caller gets served — meaning the order posts and the
 * funds lock. Settlement happens afterwards and produces the receipt.
 *
 * The service fee this collects and the order value the escrow holds are two
 * different flows on two different rails, and nothing in this file touches the
 * escrow. The fee is what qualifies the project for the prize; the order value
 * is the product.
 *
 * Header names are version 2's, taken from the published `@x402/core` bundle:
 * `PAYMENT-REQUIRED` states the price, `PAYMENT-SIGNATURE` carries the
 * payment, `PAYMENT-RESPONSE` returns the receipt. `X-PAYMENT` is version 1
 * and appears in older documents of ours.
 */

import { assertPositive, parseTinybars } from "@handoff/schema";
import type { Facilitator } from "./facilitator.js";
import {
  HBAR_ASSET,
  X402_VERSION,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type ResourceInfo,
  type SettleResponse,
  type X402Network,
} from "./types.js";

export class GateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GateError";
  }
}

export const PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED";
export const PAYMENT_SIGNATURE_HEADER = "PAYMENT-SIGNATURE";
export const PAYMENT_RESPONSE_HEADER = "PAYMENT-RESPONSE";

/** Version 1's name. Read, never written, and only so an old client is not silently ignored. */
const LEGACY_PAYMENT_HEADER = "X-PAYMENT";

export interface GateConfig {
  readonly network: X402Network;
  /** Where the service fee lands. Never the escrow account. */
  readonly receiverAccountId: string;
  /** The per-call service fee, in tinybars, as a string. */
  readonly feeTinybars: string;
  /**
   * This service's own base URL, used to name the resource in the 402.
   *
   * Absolute rather than a path, because the payer echoes it back and a bare
   * "/orders" names no service. A v2 client rejects a 402 whose resource is
   * not an object with a URL in it.
   */
  readonly serviceUrl: string;
  /** How long the facilitator may take. Their documented example is 300. */
  readonly maxTimeoutSeconds?: number;
}

/** Case-insensitive header lookup, because HTTP header names are not case-sensitive. */
export type HeaderLookup = (name: string) => string | undefined;

export function headerLookup(headers: Readonly<Record<string, string | undefined>>): HeaderLookup {
  const lower = new Map<string, string>();
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) {
      lower.set(name.toLowerCase(), value);
    }
  }
  return (name) => lower.get(name.toLowerCase());
}

export function buildRequirements(config: GateConfig, feePayer: string): PaymentRequirements {
  // Through the money module, so a fee that is not a whole positive number of
  // tinybars fails here rather than at the facilitator.
  assertPositive(parseTinybars(config.feeTinybars));

  return {
    scheme: "exact",
    network: config.network,
    amount: config.feeTinybars,
    payTo: config.receiverAccountId,
    maxTimeoutSeconds: config.maxTimeoutSeconds ?? 300,
    asset: HBAR_ASSET,
    extra: { feePayer },
  };
}

export function paymentRequired(
  requirements: PaymentRequirements,
  resource: ResourceInfo,
  error?: string,
): PaymentRequired {
  return {
    x402Version: X402_VERSION,
    accepts: [requirements],
    resource,
    ...(error === undefined ? {} : { error }),
  };
}

/**
 * The absolute URL of a gated path on this service.
 *
 * Throws rather than falling back to the path, because a resource the payer
 * cannot resolve is the kind of thing that is only noticed on camera.
 */
export function resourceInfo(serviceUrl: string, path: string): ResourceInfo {
  let url: string;
  try {
    url = new URL(path, serviceUrl).toString();
  } catch {
    throw new GateError(
      `serviceUrl ${JSON.stringify(serviceUrl)} is not a URL, so the 402 cannot name ` +
        `what it is charging for. Set HANDOFF_SERVICE_URL.`,
    );
  }
  return { url };
}

/** Base64 of the JSON, which is what `@x402/core` encodes and decodes. */
export function encodePaymentRequired(value: PaymentRequired): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export function decodePaymentSignature(header: string): PaymentPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    throw new GateError("payment header is not base64-encoded JSON");
  }

  const candidate = parsed as Partial<PaymentPayload> & Record<string, unknown>;

  // A v1 payload is a recognisable shape rather than a mystery. Saying so
  // costs one branch and saves the evening someone spends on
  // "not an x402 payload" when they sent a perfectly good version 1 one.
  if (candidate.accepted === undefined && typeof candidate["scheme"] === "string") {
    throw new GateError(
      "payment header is a version 1 payload, with scheme and network at the top level. " +
        "This service speaks version 2, where they live in `accepted`.",
    );
  }

  if (
    typeof candidate.accepted !== "object" ||
    candidate.accepted === null ||
    candidate.accepted.scheme !== "exact" ||
    typeof candidate.accepted.network !== "string" ||
    typeof candidate.payload?.transaction !== "string"
  ) {
    throw new GateError("payment header is not an exact-scheme x402 payload");
  }

  return candidate as PaymentPayload;
}

export type GateOutcome =
  | {
      readonly kind: "payment-required";
      readonly status: 402;
      readonly headers: Readonly<Record<string, string>>;
      readonly body: PaymentRequired;
    }
  | {
      readonly kind: "paid";
      readonly payload: PaymentPayload;
      readonly requirements: PaymentRequirements;
      readonly payer: string | undefined;
    };

export interface GateDeps {
  readonly facilitator: Facilitator;
  readonly config: GateConfig;
}

/**
 * Decide whether this call gets served.
 *
 * Never throws for an unpaid or an invalid payment: both are ordinary answers
 * with a price attached, and a client that just learned the price should be
 * able to pay it on the next call.
 */
export async function gate(
  lookup: HeaderLookup,
  path: string,
  deps: GateDeps,
): Promise<GateOutcome> {
  const feePayer = await deps.facilitator.feePayer(deps.config.network);
  const requirements = buildRequirements(deps.config, feePayer);
  const resource = resourceInfo(deps.config.serviceUrl, path);

  const header = lookup(PAYMENT_SIGNATURE_HEADER) ?? lookup(LEGACY_PAYMENT_HEADER);
  if (header === undefined) {
    return challenge(requirements, resource);
  }

  let payload: PaymentPayload;
  try {
    payload = decodePaymentSignature(header);
  } catch (error) {
    return challenge(requirements, resource, (error as Error).message);
  }

  // The quote the payer echoed back, not a top-level field: version 2 has no
  // top-level network to read.
  if (payload.accepted.network !== requirements.network) {
    return challenge(
      requirements,
      resource,
      `payment is for ${payload.accepted.network}, this service settles on ${requirements.network}`,
    );
  }

  const verified = await deps.facilitator.verify(payload, requirements);
  if (!verified.isValid) {
    return challenge(
      requirements,
      resource,
      verified.invalidReason ?? verified.invalidMessage ?? "payment did not verify",
    );
  }

  return { kind: "paid", payload, requirements, payer: verified.payer };
}

function challenge(
  requirements: PaymentRequirements,
  resource: ResourceInfo,
  error?: string,
): Extract<GateOutcome, { kind: "payment-required" }> {
  const body = paymentRequired(requirements, resource, error);
  return {
    kind: "payment-required",
    status: 402,
    headers: {
      [PAYMENT_REQUIRED_HEADER]: encodePaymentRequired(body),
      // The v2 client reads the header; the body is the v1 fallback and is
      // also what a human sees when they curl the endpoint.
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body,
  };
}

/**
 * Settle after serving, and hand back the header carrying the receipt.
 *
 * A failed settlement does not un-serve the resource. The order is posted and
 * the funds are locked by then, and refusing to admit the fee failed would
 * lose the only transaction id the fee leg produces.
 */
export async function settle(
  outcome: Extract<GateOutcome, { kind: "paid" }>,
  deps: GateDeps,
): Promise<{ readonly receipt: SettleResponse; readonly headers: Readonly<Record<string, string>> }> {
  const receipt = await deps.facilitator.settle(outcome.payload, outcome.requirements);
  return {
    receipt,
    headers: {
      [PAYMENT_RESPONSE_HEADER]: Buffer.from(JSON.stringify(receipt), "utf8").toString("base64"),
    },
  };
}
