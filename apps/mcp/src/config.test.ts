import { describe, expect, it } from "vitest";
import { chainModeFromEnv, configFromEnv, ConfigError, type Env } from "./config.js";

const COMPLETE: Env = {
  X402_RECEIVER_ACCOUNT_ID: "0.0.10376656",
  X402_FEE_TINYBARS: "100000",
  HANDOFF_ORDERS_TOPIC_ID: "0.0.999",
  HANDOFF_ATTESTATIONS_TOPIC_ID: "0.0.1000",
  HANDOFF_CERT_TAGS: "cpa-us=Licensed reviewer",
};

describe("configFromEnv", () => {
  it("defaults to the hosted testnet facilitator", () => {
    const config = configFromEnv(COMPLETE);

    expect(config.facilitatorUrl).toBe("https://api.testnet.blocky402.com");
    expect(config.network).toBe("hedera:testnet");
    expect(config.port).toBe(4021);
  });

  it("refuses to start on any network but testnet", () => {
    // Hard rule 5. The check is here rather than at the first call so a
    // misconfigured process never comes up, instead of failing in front of a
    // judge halfway through a demo.
    for (const network of ["hedera:mainnet", "eip155:1", "hedera:previewnet"]) {
      expect(() => configFromEnv({ ...COMPLETE, X402_NETWORK: network })).toThrow(ConfigError);
      expect(() => configFromEnv({ ...COMPLETE, X402_NETWORK: network })).toThrow(/testnet only/i);
    }
  });

  it("accepts testnet stated explicitly", () => {
    expect(configFromEnv({ ...COMPLETE, X402_NETWORK: "hedera:testnet" }).network).toBe(
      "hedera:testnet",
    );
  });

  it("names the variable that is missing", () => {
    for (const name of Object.keys(COMPLETE)) {
      const partial = { ...COMPLETE, [name]: undefined };
      expect(() => configFromEnv(partial)).toThrow(new RegExp(`${name} is not set`));
    }
  });

  it("treats blank and whitespace as missing rather than as a value", () => {
    expect(() => configFromEnv({ ...COMPLETE, X402_FEE_TINYBARS: "" })).toThrow(/is not set/);
    expect(() => configFromEnv({ ...COMPLETE, X402_FEE_TINYBARS: "   " })).toThrow(/is not set/);
  });

  it("trims, because a trailing space in a .env file is invisible", () => {
    const config = configFromEnv({ ...COMPLETE, X402_RECEIVER_ACCOUNT_ID: " 0.0.10376656 " });

    expect(config.receiverAccountId).toBe("0.0.10376656");
  });

  it("carries the fee through as the string it was given", () => {
    // Money is never a number here. The gate validates the amount through the
    // money module; this layer must not quietly reinterpret it on the way.
    const config = configFromEnv({ ...COMPLETE, X402_FEE_TINYBARS: "100000" });

    expect(config.feeTinybars).toBe("100000");
    expect(typeof config.feeTinybars).toBe("string");
  });

  it("has no default fee, because the price is ratified once and never guessed", () => {
    const { X402_FEE_TINYBARS: _omitted, ...withoutFee } = COMPLETE;

    expect(() => configFromEnv(withoutFee)).toThrow(/X402_FEE_TINYBARS is not set/);
  });

  it("rejects a port that is not one, including the ones parseInt would accept", () => {
    // "8080.5" and "80abc" are the interesting cases: parseInt reads them as
    // 8080 and 80 and hands back something that looks valid.
    for (const port of ["0", "-1", "http", "8080.5", "80abc", "70000", ""]) {
      expect(() => configFromEnv({ ...COMPLETE, PORT: port })).toThrow(ConfigError);
    }
  });

  describe("serviceUrl", () => {
    it("falls back to this process's own port, which is right for local work", () => {
      expect(configFromEnv({ ...COMPLETE, PORT: "4099" }).serviceUrl).toBe(
        "http://localhost:4099",
      );
    });

    it("takes HANDOFF_SERVICE_URL when the service is behind a hostname", () => {
      expect(
        configFromEnv({ ...COMPLETE, HANDOFF_SERVICE_URL: "https://handoff.example/" })
          .serviceUrl,
      ).toBe("https://handoff.example/");
    });

    it("treats an empty value as unset rather than as an empty URL", () => {
      // A 402 whose resource is "" names nothing, and the payer echoes it.
      expect(configFromEnv({ ...COMPLETE, HANDOFF_SERVICE_URL: "  " }).serviceUrl).toBe(
        "http://localhost:4021",
      );
    });
  });

  describe("chainModeFromEnv", () => {
    it("defaults to mock, so nothing posts to testnet by accident", () => {
      expect(chainModeFromEnv({})).toBe("mock");
      expect(chainModeFromEnv({ HANDOFF_CHAIN: "  " })).toBe("mock");
      expect(chainModeFromEnv({ HANDOFF_CHAIN: "mock" })).toBe("mock");
    });

    it("reads testnet", () => {
      expect(chainModeFromEnv({ HANDOFF_CHAIN: " testnet " })).toBe("testnet");
    });

    it("refuses anything else rather than falling through to the mock", () => {
      // A typo that silently ran on the mock would put MOCK-tx ids in front of
      // a camera, and they 404 on Hashscan.
      expect(() => chainModeFromEnv({ HANDOFF_CHAIN: "testent" })).toThrow(ConfigError);
      expect(() => chainModeFromEnv({ HANDOFF_CHAIN: "mainnet" })).toThrow(/mock.*testnet/);
    });
  });

  it("takes no key of any kind out of the environment", () => {
    // This process states a price, asks the facilitator and posts an order.
    // The payer's key lives in the requester and the platform keys live in the
    // chain package; a key reaching this config would be a real finding.
    const config = configFromEnv({
      ...COMPLETE,
      X402_PAYER_PRIVATE_KEY: "0xdeadbeef",
      HEDERA_OPERATOR_KEY: "0xdeadbeef",
    });

    expect(Object.keys(config).sort()).toEqual([
      "attestationsTopicId",
      "certTags",
      "facilitatorUrl",
      "feeTinybars",
      "network",
      "ordersTopicId",
      "port",
      "receiverAccountId",
      "serviceUrl",
    ]);
    expect(JSON.stringify(config)).not.toContain("deadbeef");
  });
});
