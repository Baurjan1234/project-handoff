/**
 * Configuration, from the environment.
 *
 * Two things are deliberately absent. There is no private key of any kind:
 * anything prefixed `VITE_` is bundled into the browser build, so a key here
 * would be a key in a JavaScript file, and a variable whose name says it is
 * one refuses to boot. And there is no mainnet: the mode type has two members
 * and neither is it.
 *
 * Who signs is not configuration either. The account comes from the person at
 * the connect screen; the environment may prefill the field and nothing more.
 *
 * The mock has its own block, because the things only the mock needs (whose
 * funds the seeded order locks, what it costs) must not exist as fields on a
 * testnet configuration where nothing reads them.
 */

import { assertPositive, hbarToTinybars } from "@handoff/schema";
import { parseAccountId } from "../session/accountId";
import { describePrivateKey } from "../session/keyShape";
import { looksLikeSecretName, secretNameMessage } from "./secretNames";

export type ChainMode = "mock" | "testnet";

interface Common {
  /** Prefills the connect screen. Optional, and never the source of who signs. */
  readonly expertAccountIdPrefill: string | null;
  /** Where orders are published and, until P1 says otherwise, attestations too. */
  readonly ordersTopicId: string;
}

export interface MockChainConfig extends Common {
  readonly mode: "mock";
  readonly mock: {
    /** Whose funds the seeded demo order locks. */
    readonly requesterAccountId: string;
    /**
     * The seeded orders' price, in HBAR as a string. The default is the
     * committed demo price, 100 HBAR, settled in
     * docs/decisions/2026-09-06-demo-price-and-x402-fee.md because the
     * faucet gives exactly that per call. Never changed on camera.
     */
    readonly priceHbar: string;
  };
}

export interface TestnetChainConfig extends Common {
  readonly mode: "testnet";
}

export type WebChainConfig = MockChainConfig | TestnetChainConfig;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type Env = Readonly<Record<string, string | undefined>>;

const DEMO_PRICE_HBAR = "100";

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (value === undefined || value === "") {
    throw new ConfigError(`${name} is not set. See apps/web/.env.example.`);
  }
  return value;
}

function optionalAccountId(env: Env, name: string): string | null {
  const value = env[name]?.trim();
  if (value === undefined || value === "") return null;
  const parsed = parseAccountId(value);
  if (!parsed.ok) throw new ConfigError(`${name} is set but is not an account id like 0.0.12345. ${parsed.reason}`);
  return parsed.accountId;
}

/** A price. Same rule as the envelope's: a real amount, and zero is not a price. */
function hbarAmount(env: Env, name: string, fallback: string): string {
  const value = env[name]?.trim() || fallback;
  try {
    assertPositive(hbarToTinybars(value));
  } catch (error) {
    throw new ConfigError(`${name} is ${value}: ${(error as Error).message}`);
  }
  return value;
}

/**
 * Hard rule 2, as a startup failure. Two checks: a name that says secret,
 * and a value shaped like a private key under any name. Neither message
 * repeats the value.
 */
function refuseSecrets(env: Env): void {
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("VITE_")) continue;
    if (looksLikeSecretName(name)) throw new ConfigError(secretNameMessage(name));
    if (value !== undefined && describePrivateKey(value).ok) {
      throw new ConfigError(
        `${name} holds what looks like a private key. Anything prefixed VITE_ is bundled into the browser build. Remove it.`,
      );
    }
  }
}

export function configFromEnv(env: Env): WebChainConfig {
  refuseSecrets(env);

  const mode = env["VITE_CHAIN"]?.trim() ?? "mock";
  if (mode !== "mock" && mode !== "testnet") {
    // Hard rule 5. Refusing here means a misconfigured app never renders.
    throw new ConfigError(`VITE_CHAIN is ${mode}. This app runs against "mock" or "testnet" and nothing else.`);
  }

  const expertAccountIdPrefill = optionalAccountId(env, "VITE_EXPERT_ACCOUNT_ID");

  if (mode === "mock") {
    return {
      mode,
      expertAccountIdPrefill,
      ordersTopicId: env["VITE_HANDOFF_ORDERS_TOPIC_ID"]?.trim() || "MOCK-topic-orders",
      mock: {
        requesterAccountId: env["VITE_MOCK_REQUESTER_ACCOUNT_ID"]?.trim() || "MOCK-requester",
        priceHbar: hbarAmount(env, "VITE_MOCK_PRICE_HBAR", DEMO_PRICE_HBAR),
      },
    };
  }

  return {
    mode,
    expertAccountIdPrefill,
    ordersTopicId: required(env, "VITE_HANDOFF_ORDERS_TOPIC_ID"),
  };
}
