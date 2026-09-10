import { describe, expect, it } from "vitest";
import { mirrorPayoutLocator, payoutQueryUrl, tinybarsOf, toSdkTransactionId } from "./payoutLocator";

const EXPERT = "0.0.12345";
const ESCROW = "0.0.999";
const PRICE = "10000000000";

const params = {
  mirrorNodeUrl: "https://testnet.mirrornode.hedera.com/api/v1/",
  expertAccountId: EXPERT,
  escrowAccountId: ESCROW,
  amountTinybars: PRICE,
  notBefore: "1757000000.000000001",
};

function answering(transactions: unknown[]) {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    urls.push(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    return new Response(JSON.stringify({ transactions }), { status: 200 });
  };
  return { fetchImpl, urls };
}

const payout = {
  transaction_id: "0.0.4242-1757000010-000000000",
  consensus_timestamp: "1757000010.000000000",
  result: "SUCCESS",
  transfers: [
    { account: ESCROW, amount: -10000000000 },
    { account: EXPERT, amount: 10000000000 },
    { account: "0.0.98", amount: 12345 },
  ],
};

describe("mirrorPayoutLocator", () => {
  it("asks the mirror node for the expert's successful transfers since the verdict", () => {
    const url = payoutQueryUrl(params);
    expect(url).toBe(
      "https://testnet.mirrornode.hedera.com/api/v1/transactions?account.id=0.0.12345&timestamp=gte%3A1757000000.000000001&transactiontype=CRYPTOTRANSFER&result=success&order=asc&limit=50",
    );
  });

  it("finds the transfer that moves exactly the order value from the escrow to the expert, in the SDK's id spelling", async () => {
    const { fetchImpl } = answering([payout]);
    const id = await mirrorPayoutLocator({ ...params, fetchImpl }).locate();
    expect(id).toBe("0.0.4242@1757000010.000000000");
  });

  it("is null until such a transfer exists, and ignores a transfer of the wrong amount or from elsewhere", async () => {
    const wrongAmount = { ...payout, transfers: [{ account: ESCROW, amount: -5 }, { account: EXPERT, amount: 5 }] };
    const wrongSource = { ...payout, transfers: [{ account: "0.0.77", amount: -10000000000 }, { account: EXPERT, amount: 10000000000 }] };
    const { fetchImpl } = answering([wrongAmount, wrongSource]);
    expect(await mirrorPayoutLocator({ ...params, fetchImpl }).locate()).toBeNull();
    expect(await mirrorPayoutLocator({ ...params, fetchImpl: answering([]).fetchImpl }).locate()).toBeNull();
  });

  it("throws on a mirror node that does not answer, which the watcher treats as not-yet", async () => {
    const fetchImpl: typeof fetch = async () => new Response(null, { status: 503 });
    await expect(mirrorPayoutLocator({ ...params, fetchImpl }).locate()).rejects.toThrow("503");
  });

  it("converts the mirror node's id spelling and refuses anything else", () => {
    expect(toSdkTransactionId("0.0.4242-1757000010-000000000")).toBe("0.0.4242@1757000010.000000000");
    expect(() => toSdkTransactionId("MOCK-tx-7")).toThrow("Not a mirror-node transaction id");
  });

  it("refuses an amount the mirror node did not send as an exact integer, instead of comparing it", async () => {
    expect(tinybarsOf(10000000000)).toBe(10000000000n);
    expect(tinybarsOf(-5)).toBe(-5n);
    expect(() => tinybarsOf(1.5)).toThrow("not an exact integer");
    expect(() => tinybarsOf(2 ** 53)).toThrow("not an exact integer");
    expect(() => tinybarsOf("100")).toThrow("not an exact integer");
    const odd = { ...payout, transfers: [{ account: ESCROW, amount: -1e10 }, { account: EXPERT, amount: 1e10 + 0.5 }] };
    await expect(mirrorPayoutLocator({ ...params, fetchImpl: answering([odd]).fetchImpl }).locate()).rejects.toThrow("not an exact integer");
  });
});
