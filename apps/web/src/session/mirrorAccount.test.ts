import { describe, expect, it } from "vitest";
import { accountLookupUrl, interpretAccountBody, lookupAccount } from "./mirrorAccount";

const ACCOUNT = "0.0.12345";

// The shape of a live testnet answer on 2026-09-07, with a fabricated public key.
const found = {
  account: ACCOUNT,
  key: { _type: "ECDSA_SECP256K1", key: `02${"ab".repeat(32)}` },
  balance: { balance: 100000000000, timestamp: "1788434680.710100104", tokens: [] },
  deleted: false,
  evm_address: "0x0000000000000000000000000000000000000000",
};

function fetchReturning(status: number, body: unknown, seen: string[] = []): typeof fetch {
  return (async (input) => {
    seen.push(String(input));
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("lookupAccount", () => {
  it("asks the testnet mirror node, and nothing else, for the account without its transactions", async () => {
    const seen: string[] = [];
    await lookupAccount(ACCOUNT, { fetch: fetchReturning(200, found, seen) });
    expect(seen).toEqual([`https://testnet.mirrornode.hedera.com/api/v1/accounts/${ACCOUNT}?transactions=false`]);
    expect(accountLookupUrl("0.0.1")).not.toContain("mainnet");
  });

  it("maps a found account to its curve, public key and balance as a string", async () => {
    const result = await lookupAccount(ACCOUNT, { fetch: fetchReturning(200, found) });
    expect(result).toEqual({
      status: "found",
      accountId: ACCOUNT,
      keyType: "ECDSA_SECP256K1",
      publicKey: found.key.key,
      balanceTinybars: "100000000000",
      deleted: false,
    });
    expect(typeof (result as { balanceTinybars: unknown }).balanceTinybars).toBe("string");
  });

  it("maps 404 to not-found and other failures to unreachable, with the reason", async () => {
    expect(await lookupAccount(ACCOUNT, { fetch: fetchReturning(404, { _status: { messages: [] } }) })).toEqual({
      status: "not-found",
      accountId: ACCOUNT,
    });
    expect(await lookupAccount(ACCOUNT, { fetch: fetchReturning(503, {}) })).toEqual({
      status: "unreachable",
      accountId: ACCOUNT,
      reason: "HTTP 503",
    });
    const failing = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    expect(await lookupAccount(ACCOUNT, { fetch: failing })).toEqual({
      status: "unreachable",
      accountId: ACCOUNT,
      reason: "Failed to fetch",
    });
  });

  it("gives up after the timeout and says so", async () => {
    const hanging = ((_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof fetch;
    const result = await lookupAccount(ACCOUNT, { fetch: hanging, timeoutMs: 20 });
    expect(result).toMatchObject({ status: "unreachable", reason: expect.stringContaining("no answer") });
  });
});

describe("interpretAccountBody", () => {
  it("reports a key it cannot sign for rather than pretending", () => {
    expect(interpretAccountBody(ACCOUNT, { ...found, key: { _type: "ProtobufEncoded", key: "0a" } })).toEqual({
      status: "unsupported-key",
      accountId: ACCOUNT,
      reported: "ProtobufEncoded",
    });
    expect(interpretAccountBody(ACCOUNT, { ...found, key: null })).toMatchObject({ status: "unsupported-key" });
  });

  it("carries the deleted flag and drops a balance it cannot carry exactly", () => {
    expect(interpretAccountBody(ACCOUNT, { ...found, deleted: true })).toMatchObject({ status: "found", deleted: true });
    expect(interpretAccountBody(ACCOUNT, { ...found, balance: { balance: 2 ** 60 } })).toMatchObject({
      status: "found",
      balanceTinybars: null,
    });
    expect(interpretAccountBody(ACCOUNT, { ...found, balance: null })).toMatchObject({ balanceTinybars: null });
  });

  it("treats a body that is not an account as unreachable, never as found", () => {
    expect(interpretAccountBody(ACCOUNT, "<html>")).toMatchObject({ status: "unreachable" });
    expect(interpretAccountBody(ACCOUNT, null)).toMatchObject({ status: "unreachable" });
  });
});
