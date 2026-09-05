/**
 * The Blocky402 facilitator client.
 *
 * Three endpoints: `/supported` to discover who co-signs, `/verify` to decide
 * whether to serve, `/settle` to get the receipt. Testnet needs no
 * authentication.
 *
 * The fee payer is discovered rather than configured. Blocky402 co-signs as
 * the designated fee payer, and `extra.feePayer` in our payment requirements
 * has to name the same account they will sign with. Hard-code it and a
 * rotation on their side fails verification with nothing on screen to explain
 * it.
 */

import {
  X402_VERSION,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleResponse,
  type SupportedResponse,
  type VerifyResponse,
  type X402Network,
} from "./types.js";

export class FacilitatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FacilitatorError";
  }
}

/**
 * Hosts this client will talk to.
 *
 * Hard rule 5 as code rather than a comment: `api.blocky402.com` is mainnet
 * and is unreachable from here by construction. Localhost is allowed because
 * Blocky402 is self-hostable and a local instance is still testnet.
 */
const ALLOWED_HOSTS = new Set(["api.testnet.blocky402.com", "localhost", "127.0.0.1"]);

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface FacilitatorOptions {
  readonly baseUrl: string;
  readonly fetch?: FetchLike;
}

export class Facilitator {
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;
  #feePayer: string | undefined;

  constructor(options: FacilitatorOptions) {
    const url = new URL(options.baseUrl);
    if (!ALLOWED_HOSTS.has(url.hostname)) {
      throw new FacilitatorError(
        `${url.hostname} is not an allowed facilitator host. Testnet only: ` +
          `api.testnet.blocky402.com, or a local instance.`,
      );
    }

    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async #post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new FacilitatorError(
        `${path} answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
      );
    }

    return (await response.json()) as T;
  }

  async supported(): Promise<SupportedResponse> {
    const response = await this.#fetch(`${this.#baseUrl}/supported`);
    if (!response.ok) {
      throw new FacilitatorError(`/supported answered ${response.status}`);
    }
    return (await response.json()) as SupportedResponse;
  }

  /**
   * Who the facilitator co-signs as, for this network.
   *
   * Cached for the life of the process: it is stable within a run, and a
   * lookup on every 402 would make the gate depend on their uptime twice.
   */
  async feePayer(network: X402Network): Promise<string> {
    if (this.#feePayer !== undefined) {
      return this.#feePayer;
    }

    const supported = await this.supported();
    const kind = supported.kinds.find(
      (k) => k.network === network && k.x402Version === X402_VERSION,
    );
    const discovered = kind?.extra?.feePayer ?? supported.signers?.["hedera:*"]?.[0];

    if (discovered === undefined) {
      throw new FacilitatorError(
        `the facilitator does not advertise a fee payer for ${network} at x402 version ` +
          `${X402_VERSION}. Serving a 402 whose feePayer we guessed would fail verification.`,
      );
    }

    this.#feePayer = discovered;
    return discovered;
  }

  verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    return this.#post<VerifyResponse>("/verify", {
      x402Version: X402_VERSION,
      paymentPayload,
      paymentRequirements,
    });
  }

  /**
   * Settlement is asynchronous on their side and returns a Hedera receipt.
   * Verification is what gates serving; this is what produces the id we show.
   */
  settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    return this.#post<SettleResponse>("/settle", {
      x402Version: X402_VERSION,
      paymentPayload,
      paymentRequirements,
    });
  }
}
