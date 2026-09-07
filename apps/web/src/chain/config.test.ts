import { describe, expect, it } from "vitest";
import { ConfigError, configFromEnv } from "./config";

const expert = "0.0.12345";

describe("configFromEnv", () => {
  it("defaults to the mock and gives mock ids to what it cannot know yet", () => {
    expect(configFromEnv({})).toEqual({
      mode: "mock",
      expertAccountIdPrefill: null,
      ordersTopicId: "MOCK-topic-orders",
      mock: { requesterAccountId: "MOCK-requester", priceHbar: "200" },
    });
  });

  it("takes the expert account as a prefill only, and only in account-id form", () => {
    expect(configFromEnv({ VITE_EXPERT_ACCOUNT_ID: ` ${expert} ` }).expertAccountIdPrefill).toBe(expert);
    expect(configFromEnv({ VITE_EXPERT_ACCOUNT_ID: " " }).expertAccountIdPrefill).toBeNull();
    // An EVM alias is the same account, but it is not the id the SDK signs with.
    expect(() =>
      configFromEnv({ VITE_EXPERT_ACCOUNT_ID: "0x00000000000000000000000000000000000abcde" }),
    ).toThrow(ConfigError);
  });

  it("refuses to boot with a VITE_ variable whose name says secret, without reading it", () => {
    for (const name of ["VITE_PRIVATE_KEY", "VITE_EXPERT_SECRET", "VITE_MNEMONIC", "VITE_SEED_PHRASE", "VITE_operator_private"]) {
      let message = "";
      try {
        configFromEnv({ [name]: "302e0201003005" });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain(name);
      expect(message).toContain("bundled into the browser build");
      expect(message).not.toContain("302e");
    }
    // A public key for the content store is a legitimate VITE_ variable.
    expect(() => configFromEnv({ VITE_SUPABASE_ANON_KEY: "eyJ" })).not.toThrow();
    // Only VITE_ names are bundled; the rest never reach the browser.
    expect(() => configFromEnv({ OPERATOR_PRIVATE_KEY: "x" })).not.toThrow();
  });

  it("refuses any mode that is not mock or testnet", () => {
    expect(() => configFromEnv({ VITE_CHAIN: "previewnet" })).toThrow(ConfigError);
    expect(() => configFromEnv({ VITE_CHAIN: "" })).toThrow(ConfigError);
  });

  it("takes the mock price from the environment and refuses one that is not money", () => {
    const priced = configFromEnv({ VITE_MOCK_PRICE_HBAR: "150.5" });
    expect(priced.mode === "mock" && priced.mock.priceHbar).toBe("150.5");
    expect(() => configFromEnv({ VITE_MOCK_PRICE_HBAR: "2e2" })).toThrow(ConfigError);
    expect(() => configFromEnv({ VITE_MOCK_PRICE_HBAR: "0.123456789" })).toThrow(ConfigError);
  });

  it("refuses a mock price that is not a price, as the envelope would, but in its own words", () => {
    for (const value of ["0", "0.0", "-5"]) {
      expect(() => configFromEnv({ VITE_MOCK_PRICE_HBAR: value })).toThrow(/VITE_MOCK_PRICE_HBAR/);
    }
  });

  it("requires a real topic on testnet, and carries nothing the mock needs", () => {
    expect(() => configFromEnv({ VITE_CHAIN: "testnet" })).toThrow(/VITE_HANDOFF_ORDERS_TOPIC_ID/);
    expect(
      configFromEnv({
        VITE_EXPERT_ACCOUNT_ID: expert,
        VITE_CHAIN: "testnet",
        VITE_HANDOFF_ORDERS_TOPIC_ID: "0.0.4242",
        VITE_MOCK_PRICE_HBAR: "1",
      }),
    ).toEqual({ mode: "testnet", expertAccountIdPrefill: expert, ordersTopicId: "0.0.4242" });
  });
});
