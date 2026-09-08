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

/**
 * One credential tag: the code an order carries, and the name a person reads.
 *
 * Both are needed and they are not the same string. The envelope and the
 * registry speak `cpa-us`; the requester's failure reply has to say "Licensed
 * reviewer" or it is naming an internal identifier at somebody who never chose
 * it.
 */
export interface CertTagOption {
  readonly code: string;
  readonly label: string;
}

export interface ServiceConfig {
  readonly facilitatorUrl: string;
  readonly network: X402Network;
  /** Where the service fee lands. Never the escrow. */
  readonly receiverAccountId: string;
  /** The per-call service fee, in tinybars. */
  readonly feeTinybars: string;
  /**
   * This service's own base URL, which the 402 uses to name what it charges
   * for. The payer echoes it back, so a path would name no service at all.
   */
  readonly serviceUrl: string;
  /** The HCS topic order envelopes are published to. */
  readonly ordersTopicId: string;
  /**
   * The HCS topic experts publish attestations to.
   *
   * Read-only here. This process never submits an attestation — the expert
   * signs that message from their own account, which is the whole point of it.
   */
  readonly attestationsTopicId: string;
  /**
   * The credential tags an order may be routed to, in declaration order.
   *
   * The tag is the routing: there is no broadcast, and only certified inboxes
   * holding the tag see the order. So the wrong tag has to be impossible
   * rather than discouraged, which means the list has to be enumerable before
   * an agent picks one.
   *
   * This belongs to the registry (NAS-27) once that exists. Until then it is
   * configuration, in one place, read by both the tool schema and the server.
   */
  readonly certTags: readonly CertTagOption[];
  /** Whose funds the escrow locks. */
  readonly requesterAccountId: string;
  readonly port: number;
}

/**
 * Which chain this process talks to.
 *
 * Parsed rather than compared inline so an unknown value is a refusal with a
 * message, never a silent fall-through to the mock. A mock transaction id 404s
 * on Hashscan, and one reaching a recording is the failure this project cannot
 * afford.
 */
export type ChainMode = "mock" | "testnet";

export function chainModeFromEnv(env: Env = process.env): ChainMode {
  const mode = env["HANDOFF_CHAIN"]?.trim();
  if (mode === undefined || mode === "" || mode === "mock") return "mock";
  if (mode === "testnet") return "testnet";
  throw new ConfigError(`HANDOFF_CHAIN is ${JSON.stringify(mode)}. Use "mock" or "testnet".`);
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
    // Defaults to this process's own address, which is right for local work
    // and wrong the moment it is behind a hostname. Same default as the MCP
    // client half in mcp/main.ts, so one variable moves both.
    serviceUrl: env["HANDOFF_SERVICE_URL"]?.trim() || `http://localhost:${port}`,
    receiverAccountId: required(env, "X402_RECEIVER_ACCOUNT_ID"),
    feeTinybars: required(env, "X402_FEE_TINYBARS"),
    ordersTopicId: required(env, "HANDOFF_ORDERS_TOPIC_ID"),
    attestationsTopicId: required(env, "HANDOFF_ATTESTATIONS_TOPIC_ID"),
    requesterAccountId: required(env, "HANDOFF_REQUESTER_ACCOUNT_ID"),
    certTags: parseCertTags(required(env, "HANDOFF_CERT_TAGS")),
    port,
  };
}

/**
 * `code=Label,code=Label` into a list.
 *
 * No default. A default list would be copied into a demo before anybody
 * decided which credentials this build actually routes to, which is the same
 * reason there is no default fee.
 */
export function parseCertTags(raw: string): readonly CertTagOption[] {
  const tags = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      const separator = entry.indexOf("=");
      if (separator <= 0 || separator === entry.length - 1) {
        throw new ConfigError(
          `HANDOFF_CERT_TAGS entry ${JSON.stringify(entry)} is not code=Label.`,
        );
      }
      return {
        code: entry.slice(0, separator).trim(),
        label: entry.slice(separator + 1).trim(),
      };
    });

  if (tags.length === 0) {
    throw new ConfigError("HANDOFF_CERT_TAGS is empty. An order has to route somewhere.");
  }

  const codes = new Set(tags.map((tag) => tag.code));
  if (codes.size !== tags.length) {
    throw new ConfigError("HANDOFF_CERT_TAGS repeats a code, so routing would be ambiguous.");
  }

  return tags;
}
