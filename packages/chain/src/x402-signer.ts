/**
 * The x402 payer signer.
 *
 * Builds the service-fee `TransferTransaction` and partially signs it with the
 * requester's ECDSA key — step 2 of the x402 flow in root `CLAUDE.md`. It sits
 * BESIDE `ChainAdapter`, never inside it, so the schema treaty and
 * `MockChainAdapter` do not change. Decided in
 * `../../../docs/decisions/2026-09-07-x402-signer-lives-in-packages-chain.md`.
 *
 * Two money flows, never conflated. This signs the **service fee**, the
 * micropayment for calling `handoff_verify`. The **order value** is escrow's
 * job and lives in `escrow.ts` and `schedule.ts`. Different rails, different
 * accounts, different sizes.
 *
 * **Nothing here is hand-rolled.** Transaction construction, the fee-payer
 * transaction id, node ids, freezing, byte encoding and the header name all
 * come out of `@x402/hedera` and `@x402/core`. Blocky402 is verified compatible
 * with exactly that scheme, and a byte-format mismatch surfaces as an opaque
 * `InvalidSignature` from the facilitator, so writing our own is a bad trade.
 * See `../../../docs/research/x402-blocky402-wire-verified.md`.
 *
 * The requester's key stays in memory in a server-side process, the same
 * constraint every other key in this package carries. Nothing here reaches a
 * browser build.
 */

import { PrivateKey, Transaction } from "@hiero-ledger/sdk";
import type { PaymentRequirements } from "@x402/core/types";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { createClientHederaSigner } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { assertPositive, parseTinybars } from "@handoff/schema";

/** Hard rule 5, in the type system. There is no mainnet member. */
export const X402_NETWORK = "hedera:testnet";

/**
 * HBAR. A token id here would mean an HTS token, and a token on testnet needs
 * an association on both the payer and the receiver before anything can flow.
 */
export const X402_HBAR_ASSET = "0.0.0";

/** Version 2. `X-PAYMENT` is the version 1 name and we do not speak version 1. */
export const PAYMENT_SIGNATURE_HEADER = "PAYMENT-SIGNATURE";

/**
 * What the SDK reports for a secp256k1 key. Measured off
 * `PrivateKey.generateECDSA().type`, not recalled — an Ed25519 key answers
 * `"ED25519"`.
 */
const ECDSA_KEY_TYPE = "secp256k1";

export class X402SignerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "X402SignerError";
  }
}

/**
 * The requirements the resource server quoted, echoed back verbatim.
 *
 * Declared here rather than imported from `apps/mcp`: a library importing a
 * deployable is backwards. The shape is structural, so the signer satisfies the
 * `PaymentSigner` port in `apps/mcp/src/mcp/client.ts` without either side
 * depending on the other.
 */
export interface X402PaymentRequirements {
  readonly scheme: string;
  readonly network: string;
  /** Tinybars, as a decimal string. Money is never a number. */
  readonly amount: string;
  readonly payTo: string;
  readonly maxTimeoutSeconds: number;
  readonly asset: string;
  /** The facilitator's own account, discovered from `/supported` at startup. */
  readonly extra: { readonly feePayer: string };
}

export interface X402SignerParams {
  /** The payer's account. An account id cannot be derived from a key on Hedera. */
  readonly accountId: string;
  /**
   * The endpoint being paid for, which rides in the payload as the record of
   * what the money bought. The quote does not carry it — the caller knows which
   * service it is talking to, so it says so here.
   */
  readonly resourceUrl: string;
  /** Must be ECDSA. The x402 scheme is secp256k1 and the portal default is not. */
  readonly privateKey: PrivateKey;
  /**
   * A hard ceiling in tinybars, per payment.
   *
   * The price arrives from the server, so without a cap a misconfigured or
   * hostile quote is signed without question. This is not the Tier 2 budget
   * prompt, which asks a human; it is a number this signer will not exceed.
   */
  readonly maxAmountTinybars: string;
}

/**
 * Turns payment requirements into the base64 `PAYMENT-SIGNATURE` value.
 *
 * One instance per payer account. Construction validates the key; signing
 * validates the quote.
 */
export class X402Signer {
  readonly #accountId: string;
  readonly #resourceUrl: string;
  readonly #http: x402HTTPClient;
  readonly #maxAmountTinybars: bigint;
  /**
   * Held for the fund lock, which is a plain Hedera transaction rather than an
   * x402 payload and so cannot go through the scheme above.
   *
   * This is the requester's key and it never leaves this process. The server
   * gets signed bytes, never the key —
   * ../../../docs/decisions/2026-09-08-requester-signs-the-fund-lock.md.
   */
  readonly #privateKey: PrivateKey;

  constructor(params: X402SignerParams) {
    // Fail here rather than at the facilitator. An Ed25519 key produces a
    // payload that verifies as invalid, and that error names the signature
    // rather than the key type, which is an evening lost.
    if (params.privateKey.type !== ECDSA_KEY_TYPE) {
      throw new X402SignerError(
        `the x402 signer needs an ECDSA key, and this one is ${params.privateKey.type}. ` +
          `Create the account with an ECDSA key on the portal rather than taking the default.`,
      );
    }

    const cap = assertPositive(parseTinybars(params.maxAmountTinybars));

    this.#accountId = params.accountId;
    this.#privateKey = params.privateKey;
    this.#resourceUrl = params.resourceUrl;
    this.#maxAmountTinybars = cap;
    this.#http = new x402HTTPClient(
      x402Client.fromConfig({
        schemes: [
          {
            network: X402_NETWORK,
            client: new ExactHederaScheme(
              createClientHederaSigner(params.accountId, params.privateKey),
            ),
            x402Version: 2,
          },
        ],
        // The library's default spend control allows only assets it recognises
        // as defaults, and HBAR is not one of them, so a default client rejects
        // every quote we will ever see. Allow HBAR explicitly and carry our own
        // cap on it. `maxAmountPerPayment: false` switches off the USD cap that
        // applies to default assets; ours is denominated in tinybars.
        spendControls: {
          maxAmountPerPayment: false,
          allowedAssets: [
            {
              network: X402_NETWORK,
              asset: X402_HBAR_ASSET,
              maxAmountPerPayment: cap.toString(),
            },
          ],
        },
      }),
    );
  }

  /** The account the fee is debited from. */
  get accountId(): string {
    return this.#accountId;
  }

  /** The ceiling this signer will not sign past, in tinybars. */
  get maxAmountTinybars(): string {
    return this.#maxAmountTinybars.toString();
  }

  /**
   * Build and partially sign the fee transfer.
   *
   * Returns the base64 payload that goes in the `PAYMENT-SIGNATURE` header: the
   * whole envelope, with `accepted` echoing the quote verbatim, not the bare
   * transaction bytes. Sending anything but the quote we were given is rejected
   * by the facilitator before it looks at the transaction at all.
   *
   * The fee payer is the facilitator, so the transaction id is generated
   * against its account and the payer never pays gas.
   */
  /**
   * Sign the fund lock the server built, on this machine.
   *
   * The same key that signs the service fee, which is what lets one signature
   * cover the transfer's debit and its fee payer both. The bytes are the
   * server's; this adds a signature and hands them back.
   */
  async signFundLock(transactionBytes: string): Promise<string> {
    const signed = await Transaction.fromBytes(
      Buffer.from(transactionBytes, "base64"),
    ).sign(this.#privateKey);
    return Buffer.from(signed.toBytes()).toString("base64");
  }

  async sign(requirements: X402PaymentRequirements): Promise<string> {
    // Hard rule 5. A quote that names another network never reaches a signature.
    if (requirements.network !== X402_NETWORK) {
      throw new X402SignerError(
        `this signer is ${X402_NETWORK} only, and the quote names ${requirements.network}.`,
      );
    }

    if (requirements.asset !== X402_HBAR_ASSET) {
      throw new X402SignerError(
        `the quote asks for asset ${requirements.asset}, and this signer pays HBAR ` +
          `(${X402_HBAR_ASSET}). A token needs an association on both accounts first.`,
      );
    }

    // Through the money module, never a float, and never a bare Number().
    // Reject a malformed amount here, where the message can say so.
    const amount = assertPositive(parseTinybars(requirements.amount));
    if (amount > this.#maxAmountTinybars) {
      throw new X402SignerError(
        `the quote is ${amount} tinybars and this signer caps a payment at ` +
          `${this.#maxAmountTinybars}. Raise the cap deliberately or refuse the quote.`,
      );
    }

    // Re-stated rather than spread through: the library types `network` as a
    // CAIP-2 template literal, and our field is a plain string precisely so
    // that a wrong network is a runtime refusal with a message rather than a
    // compile error in whoever called us. The guard above already proved the
    // two are the same value, so this echoes the quote verbatim.
    const accepted: PaymentRequirements = { ...requirements, network: X402_NETWORK };

    const payload = await this.#http.createPaymentPayload({
      x402Version: 2,
      resource: { url: this.#resourceUrl },
      accepts: [accepted],
    });

    const headers = this.#http.encodePaymentSignatureHeader(payload);
    const value = headers[PAYMENT_SIGNATURE_HEADER];
    if (value === undefined) {
      throw new X402SignerError(
        `the x402 client returned no ${PAYMENT_SIGNATURE_HEADER} header, only ` +
          `${Object.keys(headers).join(", ") || "nothing"}.`,
      );
    }

    return value;
  }
}
