/**
 * The x402 wire, as types.
 *
 * Every shape here was read from a primary source rather than remembered: the
 * Blocky402 API reference for the facilitator bodies, and the published
 * `@x402/core` bundle for the header names and the payment-required object.
 * See `../../../../docs/research/x402-blocky402-wire-verified.md`.
 *
 * We do not import `@x402/core` for these. The resource server does nothing
 * chain-shaped — it states a price, asks the facilitator, and forwards a
 * receipt — and the library's server half only works once a Hedera scheme is
 * registered, which is what drags the Hedera SDK into this workspace.
 */

/** x402 version 2. Version 1 exists and we do not speak it. */
export const X402_VERSION = 2;

/** Hard rule 5, in the type system. There is no mainnet member. */
export type X402Network = "hedera:testnet";

/**
 * HBAR. A token id here would mean a token, and a token on Hedera testnet
 * needs an association on both accounts before anything can flow.
 */
export const HBAR_ASSET = "0.0.0";

/**
 * What a 402 says it is charging for, and what the payer echoes back.
 *
 * Version 2 made this an object. Version 1 had a bare URL string, and sending
 * that string is what a v2 client rejects before it ever builds a payment —
 * measured against `PaymentRequiredV2Schema` in the published `@x402/core`
 * bundle, which types `resource` as this object and requires it.
 */
export interface ResourceInfo {
  /** Absolute, because the payer stores it and it has to name one service. */
  readonly url: string;
  readonly description?: string;
  readonly mimeType?: string;
}

export interface PaymentRequirements {
  readonly scheme: "exact";
  readonly network: X402Network;
  /** Tinybars, as a decimal string. Money is never a number. */
  readonly amount: string;
  readonly payTo: string;
  readonly maxTimeoutSeconds: number;
  readonly asset: string;
  /** `feePayer` is the facilitator's own account, discovered from /supported. */
  readonly extra: { readonly feePayer: string };
}

/** The body of a 402, and the content of the `PAYMENT-REQUIRED` header. */
export interface PaymentRequired {
  readonly x402Version: typeof X402_VERSION;
  readonly accepts: readonly PaymentRequirements[];
  readonly resource: ResourceInfo;
  /** Present when a payment was offered and rejected. */
  readonly error?: string;
}

/**
 * What the client sends back, base64-encoded, in `PAYMENT-SIGNATURE`.
 *
 * **`scheme` and `network` live in `accepted`, not at the top level.** Version
 * 1 put them at the top and version 2 did not, and an earlier shape here
 * carried the v1 fields — which meant this service rejected its own signer's
 * payload before the facilitator ever saw it. `PaymentPayloadV2Schema` in the
 * published `@x402/core` bundle has exactly four keys, and a payload captured
 * from our own `X402Signer` has the same four.
 */
export interface PaymentPayload {
  readonly x402Version: number;
  /** Echoed from the 402. Optional in the schema, so it is optional here. */
  readonly resource?: ResourceInfo;
  /** The quote being paid, verbatim. This is where scheme and network live. */
  readonly accepted: PaymentRequirements;
  readonly payload: { readonly transaction: string };
}

export interface VerifyResponse {
  readonly isValid: boolean;
  readonly payer?: string;
  readonly invalidReason?: string;
  readonly invalidMessage?: string;
}

export interface SettleResponse {
  readonly success: boolean;
  /** The Hedera transaction id. The only one the fee leg produces. */
  readonly transaction: string;
  readonly network: string;
  readonly payer?: string;
  readonly errorReason?: string;
  readonly errorMessage?: string;
}

export interface SupportedKind {
  readonly x402Version: number;
  readonly scheme: string;
  readonly network: string;
  readonly extra?: { readonly feePayer?: string };
}

export interface SupportedResponse {
  readonly kinds: readonly SupportedKind[];
  readonly signers?: Readonly<Record<string, readonly string[]>>;
}
