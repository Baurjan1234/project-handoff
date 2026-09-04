import { beforeEach, describe, expect, it } from "vitest";
import { encodeAttestation } from "./attestation.js";
import { SCHEMA_VERSION } from "./constants.js";
import { encodeEnvelope } from "./envelope.js";
import { MockChainAdapter, MockChainError } from "./mock.js";

const hash = (c: string) => c.repeat(64);

let clock = 1_757_000_000_000;
let chain: MockChainAdapter;

beforeEach(() => {
  clock = 1_757_000_000_000;
  chain = new MockChainAdapter({ now: () => (clock += 1000) });
});

const schedule = {
  orderId: "order-1",
  escrowAccountId: "MOCK-escrow-order-1",
  payeeAccountId: "0.0.5005",
  amountTinybars: "20000000000",
  expiresAt: "2026-09-14T00:00:00Z",
};

describe("the mock is visibly a mock", () => {
  it("issues transaction ids that could never pass for Hedera ids", async () => {
    const { transactionId } = await chain.submitMessage("topic-1", "hello");
    expect(transactionId).toMatch(/^MOCK-/);
    expect(transactionId).not.toMatch(/^\d+\.\d+\.\d+@/);
  });

  it("is pinned to testnet in the type system and at runtime", () => {
    expect(chain.network).toBe("testnet");
  });
});

describe("topics", () => {
  it("numbers messages in submission order, starting at one", async () => {
    const first = await chain.submitMessage("topic-1", "a");
    const second = await chain.submitMessage("topic-1", "b");
    expect([first.sequenceNumber, second.sequenceNumber]).toEqual([1, 2]);
  });

  it("keeps topics apart", async () => {
    await chain.submitMessage("topic-1", "a");
    const other = await chain.submitMessage("topic-2", "b");
    expect(other.sequenceNumber).toBe(1);
  });

  it("advances the consensus timestamp, which is how a claim race is decided", async () => {
    const first = await chain.submitMessage("topic-1", "a");
    const second = await chain.submitMessage("topic-1", "b");
    expect(Number(second.consensusTimestamp)).toBeGreaterThan(Number(first.consensusTimestamp));
  });

  it("reads back only what came after a sequence number", async () => {
    for (const c of ["a", "b", "c"]) await chain.submitMessage("topic-1", c);
    const tail = await chain.readMessages("topic-1", { afterSequenceNumber: 1 });
    expect(tail.map((m) => m.contents)).toEqual(["b", "c"]);
  });

  it("carries a real envelope and a real attestation without complaint", async () => {
    const envelope = encodeEnvelope({
      class: "review",
      order_id: "order-1",
      spec_hash: hash("1"),
      cert_tag: "cpa-us",
      price_tinybars: "20000000000",
      deadline: "2026-09-14T00:00:00Z",
      claim_timeout_seconds: 1800,
      schema_version: SCHEMA_VERSION,
      artifact_hash_in: hash("2"),
    });
    const attestation = encodeAttestation({
      class: "review",
      order_id: "order-1",
      verdict: "reject",
      defects: ["MISSING_SIGNOFF"],
      notes_hash: hash("3"),
      cert_tag: "cpa-us",
      schema_version: SCHEMA_VERSION,
      artifact_hash_in: hash("2"),
    });

    await chain.submitMessage("orders", envelope);
    await chain.submitMessage("orders", attestation);

    const messages = await chain.readMessages("orders");
    expect(messages).toHaveLength(2);
  });
});

describe("schedules", () => {
  it("needs two signatures, matching the 2-of-3 escrow", async () => {
    const { scheduleId } = await chain.createSchedule(schedule);
    expect((await chain.signSchedule(scheduleId)).executed).toBe(false);
    expect((await chain.signSchedule(scheduleId)).executed).toBe(true);
  });

  it("never pays twice, however many times it is signed", async () => {
    const { scheduleId } = await chain.createSchedule(schedule);
    await chain.signSchedule(scheduleId);
    await chain.signSchedule(scheduleId);
    const extra = await chain.signSchedule(scheduleId);

    expect(extra.executed).toBe(true);
    expect(chain.hasExecuted(scheduleId)).toBe(true);
  });

  it("returns the existing schedule for an identical create, rather than a second one", async () => {
    const first = await chain.createSchedule(schedule);
    const again = await chain.createSchedule(schedule);

    expect(again.alreadyExisted).toBe(true);
    expect(again.scheduleId).toBe(first.scheduleId);
    expect(again.transactionId).not.toBe(first.transactionId);
  });

  it("treats a different payee as a different schedule", async () => {
    const first = await chain.createSchedule(schedule);
    const other = await chain.createSchedule({ ...schedule, payeeAccountId: "0.0.6006" });
    expect(other.scheduleId).not.toBe(first.scheduleId);
  });

  it("refuses to sign a deleted schedule, which is the claim-timeout path", async () => {
    const { scheduleId } = await chain.createSchedule(schedule);
    await chain.deleteSchedule(scheduleId);
    await expect(chain.signSchedule(scheduleId)).rejects.toThrow(MockChainError);
  });

  it("refuses to claw back an order that already paid", async () => {
    const { scheduleId } = await chain.createSchedule(schedule);
    await chain.signSchedule(scheduleId);
    await chain.signSchedule(scheduleId);
    await expect(chain.deleteSchedule(scheduleId)).rejects.toThrow(/cannot be clawed back/);
  });

  it("rejects an unknown schedule id rather than silently succeeding", async () => {
    await expect(chain.signSchedule("MOCK-schedule-nope")).rejects.toThrow(MockChainError);
  });
});

describe("transaction ids are threaded, not swallowed", () => {
  it("returns a retrievable record for every operation", async () => {
    const submit = await chain.submitMessage("topic-1", "a");
    const lock = await chain.lockFunds({
      orderId: "order-1",
      amountTinybars: "20000000000",
      requesterAccountId: "0.0.4004",
    });
    const created = await chain.createSchedule(schedule);

    for (const id of [submit.transactionId, lock.transactionId, created.transactionId]) {
      const record = await chain.getTransaction(id);
      expect(record?.status).toBe("SUCCESS");
    }
  });

  it("returns null for a transaction the mirror node has not seen", async () => {
    expect(await chain.getTransaction("MOCK-tx-999")).toBeNull();
  });
});
