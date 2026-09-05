/**
 * Configuration, from the environment.
 *
 * Two things are deliberately absent. There is no fee default: the per-call
 * price is ratified once and never changed on camera, and a default here would
 * be copied into a demo before anybody decided it. And there is no private key
 * of any kind — this process states a price, asks the facilitator and posts an
 * order; the payer's key lives in the requester and the platform keys live
 * server-side in the chain package.
 */

import type { X402Network } from "./x402/types.js";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface ServiceConfig {
  readonly facilitatorUrl: string;
  readonly network: X402Network;
  /** Where the service fee lands. Never the escrow. */
  readonly receiverAccountId: string;
  /** The per-call service fee, in tinybars. */
  readonly feeTinybars: string;
  /** The HCS topic order envelopes are published to. */
  readonly ordersTopicId: string;
  /** Whose funds the escrow locks. */
  readonly requesterAccountId: string;
  readonly port: number;
}

export type Env = Readonly<Record<string, string | undefined>>;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (value === undefined || value === "") {
    throw new ConfigError(`${name} is not set. See .env.example.`);
  }
  return value;
}

export function configFromEnv(env: Env = process.env): ServiceConfig {
  const network = env["X402_NETWORK"]?.trim() ?? "hedera:testnet";
  if (network !== "hedera:testnet") {
    // Hard rule 5. Refusing here rather than in the facilitator client means
    // a misconfigured process never starts, instead of failing on first call.
    throw new ConfigError(`X402_NETWORK is ${network}. This service is testnet only.`);
  }

  // parseInt alone is not a validator: it reads "8080.5" as 8080 and "80abc"
  // as 80, so a value that is not a port becomes one silently. Same class of
  // bug as letting an amount through as a float.
  const rawPort = env["PORT"]?.trim() ?? "4021";
  const port = /^\d+$/.test(rawPort) ? Number.parseInt(rawPort, 10) : Number.NaN;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new ConfigError(`PORT is ${JSON.stringify(env["PORT"])}, which is not a port.`);
  }

  return {
    facilitatorUrl: env["X402_FACILITATOR_URL"]?.trim() ?? "https://api.testnet.blocky402.com",
    network,
    receiverAccountId: required(env, "X402_RECEIVER_ACCOUNT_ID"),
    feeTinybars: required(env, "X402_FEE_TINYBARS"),
    ordersTopicId: required(env, "HANDOFF_ORDERS_TOPIC_ID"),
    requesterAccountId: required(env, "HANDOFF_REQUESTER_ACCOUNT_ID"),
    port,
  };
}
