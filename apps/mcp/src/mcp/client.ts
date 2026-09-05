/**
 * The paying client behind the `handoff_verify` tool.
 *
 * The tool is not the gate. It is a customer of the gate: it calls
 * `POST /orders`, and if the answer is 402 it pays and calls again. That is
 * the whole reason the 402 lives in HTTP — see
 * `../../../../docs/decisions/2026-09-05-402-lives-in-an-http-resource-server.md`.
 *
 * Signing is a port, not an implementation. Building a Hedera
 * `TransferTransaction` and partially signing it with an ECDSA key is the one
 * thing here that needs a Hedera dependency, and where that dependency is
 * allowed to live is an open rule question for the team. Until it is settled,
 * the only signer wired up is one that refuses and says why, which keeps
 * everything either side of it finished and testable.
 */

import type { PaymentRequired, PaymentRequirements } from "../x402/types.js";
import { PAYMENT_REQUIRED_HEADER, PAYMENT_SIGNATURE_HEADER } from "../x402/gate.js";

export class HandoffClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandoffClientError";
  }
}

export class PaymentUnavailableError extends HandoffClientError {
  constructor(requirements: PaymentRequirements) {
    super(
      `this order costs ${requirements.amount} tinybars to ${requirements.payTo} on ` +
        `${requirements.network}, and no payment signer is wired into this build yet. ` +
        `The signer needs an ECDSA key and the x402 client library.`,
    );
    this.name = "PaymentUnavailableError";
  }
}

/**
 * Turns payment requirements into the base64 payload that goes in the
 * `PAYMENT-SIGNATURE` header.
 */
export interface PaymentSigner {
  sign(requirements: PaymentRequirements): Promise<string>;
}

/** The only signer that exists today. It fails with the price in the message. */
export class UnwiredSigner implements PaymentSigner {
  async sign(requirements: PaymentRequirements): Promise<never> {
    throw new PaymentUnavailableError(requirements);
  }
}

export interface OrderInput {
  readonly spec: string;
  readonly artifact: string;
  readonly certTag: string;
  readonly priceHbar: string;
  readonly deadline: string;
  readonly claimTimeoutSeconds: number;
}

export interface ClientDeps {
  readonly baseUrl: string;
  readonly signer: PaymentSigner;
  readonly fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

function body(input: OrderInput): string {
  return JSON.stringify({
    class: "review",
    spec: input.spec,
    // JSON has no bytes. The text never leaves the content store either way;
    // only its hash is published.
    artifact_base64: Buffer.from(input.artifact, "utf8").toString("base64"),
    cert_tag: input.certTag,
    price_hbar: input.priceHbar,
    deadline: input.deadline,
    claim_timeout_seconds: input.claimTimeoutSeconds,
  });
}

/**
 * Read the price out of a 402.
 *
 * The header is the version 2 channel and the body is the version 1 fallback,
 * so prefer the header and accept either, which is what the reference client
 * does.
 */
export async function readChallenge(response: Response): Promise<PaymentRequirements> {
  const header = response.headers.get(PAYMENT_REQUIRED_HEADER.toLowerCase());
  const challenge: PaymentRequired = header
    ? (JSON.parse(Buffer.from(header, "base64").toString("utf8")) as PaymentRequired)
    : ((await response.json()) as PaymentRequired);

  const requirements = challenge.accepts[0];
  if (requirements === undefined) {
    throw new HandoffClientError("the server answered 402 without saying what it costs");
  }
  return requirements;
}

/** Post an order, paying if asked. Returns the served body. */
export async function postOrder(
  input: OrderInput,
  deps: ClientDeps,
): Promise<Record<string, unknown>> {
  const call = deps.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const url = `${deps.baseUrl.replace(/\/+$/, "")}/orders`;
  const payload = body(input);
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  const first = await call(url, { method: "POST", headers, body: payload });
  if (first.status !== 402) {
    return finish(first);
  }

  // Echo back the requirements we were quoted. Sending anything else is
  // rejected by the facilitator before it looks at the transaction at all.
  const requirements = await readChallenge(first);
  const signed = await deps.signer.sign(requirements);

  const paid = await call(url, {
    method: "POST",
    headers: { ...headers, [PAYMENT_SIGNATURE_HEADER]: signed },
    body: payload,
  });

  if (paid.status === 402) {
    const retry = (await paid.json()) as PaymentRequired;
    throw new HandoffClientError(`the payment was rejected: ${retry.error ?? "no reason given"}`);
  }

  return finish(paid);
}

async function finish(response: Response): Promise<Record<string, unknown>> {
  const parsed = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new HandoffClientError(
      `the service answered ${response.status}: ${JSON.stringify(parsed)}`,
    );
  }
  return parsed;
}
