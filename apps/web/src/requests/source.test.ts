/**
 * The fixtures are the real thing. Every transfer shape below was measured
 * off testnet against the fund lock the brief records, so a change in how the
 * network reports a transfer fails here rather than on camera.
 */

import { describe, expect, it } from "vitest";
import { fundLocksIn, memoOf, myRequestsQueryUrl } from "./source";

const ME = "0.0.10376659";
const ESCROW = "0.0.10422187";
const ORDER = "ord_e2d590fed20043769bef835412897fd2";

function memo(text: string): string {
  return btoa(text);
}

/** The measured three-leg shape: node fee, requester (value + fee), escrow (value). */
function fundLock(overrides: Record<string, unknown> = {}) {
  return {
    transaction_id: "0.0.10376659-1789043079-412979170",
    consensus_timestamp: "1789043088.487240617",
    memo_base64: memo(ORDER),
    transfers: [
      { account: "0.0.802", amount: 263_325 },
      { account: ME, amount: -100_263_325 },
      { account: ESCROW, amount: 100_000_000 },
    ],
    ...overrides,
  };
}

describe("the query", () => {
  it("asks the network for this account's successful transfers, newest first", () => {
    const url = myRequestsQueryUrl({
      mirrorNodeUrl: "https://testnet.mirrornode.hedera.com/api/v1/",
      requesterAccountId: ME,
      escrowAccountId: ESCROW,
    });
    expect(url).toContain("account.id=0.0.10376659");
    expect(url).toContain("transactiontype=CRYPTOTRANSFER");
    expect(url).toContain("result=success");
    expect(url).toContain("order=desc");
    // The trailing slash is dropped rather than doubled.
    expect(url).not.toContain("api/v1//transactions");
  });
});

describe("the memo", () => {
  it("reads the order id out of the memo, and shrugs at anything else", () => {
    expect(memoOf({ memo_base64: memo(ORDER) })).toBe(ORDER);
    expect(memoOf({})).toBe("");
    expect(memoOf({ memo_base64: null })).toBe("");
    expect(memoOf({ memo_base64: "not base64 !!" })).toBe("");
  });
});

describe("which transfers are my requests", () => {
  it("takes the order value off the escrow's leg, never the requester's", () => {
    const [found] = fundLocksIn([fundLock()], ME, ESCROW);
    expect(found).toBeDefined();
    // The requester's leg is -100263325, value plus the fee. Matching on that
    // would find nothing, and reporting it would overstate the price.
    expect(found?.amountTinybars).toBe(100_000_000n);
    expect(found?.orderId).toBe(ORDER);
    expect(found?.lockedAt).toBe("1789043088.487240617");
  });

  it("hands back the id in the form a link wants", () => {
    const [found] = fundLocksIn([fundLock()], ME, ESCROW);
    expect(found?.lockTransactionId).toBe("0.0.10376659@1789043079.412979170");
  });

  it("ignores a transfer with no order id in its memo", () => {
    // The service fee settled by the payment service is one of these: a real
    // transfer, on the same account, memoless.
    expect(fundLocksIn([fundLock({ memo_base64: "" })], ME, ESCROW)).toEqual([]);
    expect(fundLocksIn([fundLock({ memo_base64: memo("hello") })], ME, ESCROW)).toEqual([]);
    expect(fundLocksIn([fundLock({ memo_base64: memo("ord_nothex") })], ME, ESCROW)).toEqual([]);
  });

  it("ignores a transfer that never reached the escrow", () => {
    const elsewhere = fundLock({
      transfers: [
        { account: ME, amount: -100_263_325 },
        { account: "0.0.55555", amount: 100_000_000 },
      ],
    });
    expect(fundLocksIn([elsewhere], ME, ESCROW)).toEqual([]);
  });

  it("ignores an escrow payment somebody else made", () => {
    // Same escrow, same memo shape, another requester's money. Not mine.
    const theirs = fundLock({
      transfers: [
        { account: "0.0.98765", amount: -100_263_325 },
        { account: ESCROW, amount: 100_000_000 },
      ],
    });
    expect(fundLocksIn([theirs], ME, ESCROW)).toEqual([]);
  });

  it("ignores a payout out of the escrow, which is a credit to me and a debit to it", () => {
    const payout = fundLock({
      transfers: [
        { account: ESCROW, amount: -100_000_000 },
        { account: ME, amount: 100_000_000 },
      ],
    });
    expect(fundLocksIn([payout], ME, ESCROW)).toEqual([]);
  });

  it("skips one unreadable transaction rather than losing the whole list", () => {
    // An amount past what a JSON number holds exactly, on an unrelated
    // transfer. The list must survive it.
    const unreadable = fundLock({
      memo_base64: memo("ord_ffffffffffffffffffffffffffffffff"),
      transfers: [
        { account: ME, amount: -1 },
        { account: ESCROW, amount: 9_007_199_254_740_993 },
      ],
    });
    const found = fundLocksIn([unreadable, fundLock()], ME, ESCROW);
    expect(found).toHaveLength(1);
    expect(found[0]?.orderId).toBe(ORDER);
  });

  it("skips a transaction whose id is not one it can link to", () => {
    const odd = fundLock({ transaction_id: "not-an-id" });
    expect(fundLocksIn([odd, fundLock()], ME, ESCROW)).toHaveLength(1);
  });

  it("keeps the network's order, which is newest first", () => {
    const older = fundLock({
      memo_base64: memo("ord_84527ad865714c3dabe72cd989c0fd86"),
      transaction_id: "0.0.10376659-1789040929-420622107",
      consensus_timestamp: "1789040938.000000000",
    });
    const found = fundLocksIn([fundLock(), older], ME, ESCROW);
    expect(found.map((r) => r.orderId)).toEqual([ORDER, "ord_84527ad865714c3dabe72cd989c0fd86"]);
  });
});
