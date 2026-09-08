import { describe, expect, it } from "vitest";
import { derivePendingPayoutId, PendingPayoutError, PendingPayoutStore } from "./pending-payout.js";

const PARAMS = {
  orderId: "order-1",
  escrowAccountId: "0.0.100",
  payeeAccountId: "0.0.200",
  amountTinybars: "100000000",
  expiresAt: "2026-09-14T00:00:00Z",
};

describe("derivePendingPayoutId", () => {
  it("is deterministic for identical params", () => {
    expect(derivePendingPayoutId(PARAMS)).toBe(derivePendingPayoutId({ ...PARAMS }));
  });

  it("differs when any field differs", () => {
    expect(derivePendingPayoutId(PARAMS)).not.toBe(derivePendingPayoutId({ ...PARAMS, amountTinybars: "1" }));
  });
});

describe("PendingPayoutStore", () => {
  it("create() is idempotent — identical params return the same id, alreadyExisted true the second time", () => {
    const store = new PendingPayoutStore();
    const first = store.create(PARAMS, "tx-1");
    const second = store.create(PARAMS, "tx-2");

    expect(first.alreadyExisted).toBe(false);
    expect(second.alreadyExisted).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it("markExecuted flips executed and records the payout transaction id", () => {
    const store = new PendingPayoutStore();
    const { id } = store.create(PARAMS, "tx-1");
    store.markExecuted(id, "tx-payout");

    const record = store.get(id);
    expect(record.executed).toBe(true);
    expect(record.executedTransactionId).toBe("tx-payout");
  });

  it("markDeleted refuses to cancel an already-executed payout", () => {
    const store = new PendingPayoutStore();
    const { id } = store.create(PARAMS, "tx-1");
    store.markExecuted(id, "tx-payout");

    expect(() => store.markDeleted(id)).toThrow(PendingPayoutError);
  });

  it("markDeleted succeeds on a not-yet-executed payout", () => {
    const store = new PendingPayoutStore();
    const { id } = store.create(PARAMS, "tx-1");
    store.markDeleted(id);
    expect(store.get(id).deleted).toBe(true);
  });

  it("get() throws for an unknown id", () => {
    const store = new PendingPayoutStore();
    expect(() => store.get("does-not-exist")).toThrow(PendingPayoutError);
  });
});
