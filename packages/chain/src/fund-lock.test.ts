/**
 * The real fund lock, against the real SDK, with no network.
 *
 * `MockChainAdapter`'s suite already covers the whitelist itself — it is the
 * same function. What only this file can prove is that the *decoder* agrees
 * with the *builder*: that a transfer this module freezes, once signed the way
 * a requester signs it, decodes back into facts the shared validator accepts.
 * A whitelist that passes on invented JSON and rejects real protobuf is the
 * failure this money-path suite exists to catch.
 *
 * `Client.forTestnet()` performs no I/O when it is only used to freeze; the
 * node account ids it supplies come from the bundled address book. Nothing
 * here executes a transaction.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  Transaction,
  TransferTransaction,
  TransactionId,
  TopicMessageSubmitTransaction,
} from "@hiero-ledger/sdk";
import { FundLockError, type LockFundsParams } from "@handoff/schema";
import { buildFundLock, decodeFundLock } from "./fund-lock.js";

const ESCROW = AccountId.fromString("0.0.5005");
const REQUESTER_KEY = PrivateKey.generateECDSA();
const REQUESTER = AccountId.fromString("0.0.4004");
const OTHER_KEY = PrivateKey.generateECDSA();

const params: LockFundsParams = {
  orderId: "ord_11111111-2222-3333-4444-555555555555",
  amountTinybars: "10000000000",
  requesterAccountId: REQUESTER.toString(),
};

let client: Client;

beforeEach(() => {
  // An operator that is deliberately NOT the requester: the whole point is that
  // the platform freezes a transaction somebody else pays for and signs.
  client = Client.forTestnet().setOperator(
    AccountId.fromString("0.0.10376667"),
    PrivateKey.generateECDSA(),
  );
});

async function sign(transactionBytes: string, key: PrivateKey): Promise<string> {
  const signed = await Transaction.fromBytes(
    Buffer.from(transactionBytes, "base64"),
  ).sign(key);
  return Buffer.from(signed.toBytes()).toString("base64");
}

describe("buildFundLock puts the requester on both hooks", () => {
  it("makes the requester the fee payer, not the operator", async () => {
    const built = await buildFundLock(client, ESCROW, params);
    const facts = decodeFundLock(built.transactionBytes);

    // The transaction id's account is the fee payer on Hedera. If freezeWith
    // had overwritten the id we set, this would be the operator and the
    // platform would be paying gas for every order.
    expect(facts.feePayer).toBe(REQUESTER.toString());
  });

  it("debits the requester and credits the escrow, and nothing else", async () => {
    const built = await buildFundLock(client, ESCROW, params);
    const facts = decodeFundLock(built.transactionBytes);

    expect(facts.transfers).toHaveLength(2);
    expect(facts.transfers).toContainEqual({
      accountId: REQUESTER.toString(),
      amountTinybars: `-${params.amountTinybars}`,
    });
    expect(facts.transfers).toContainEqual({
      accountId: ESCROW.toString(),
      amountTinybars: params.amountTinybars,
    });
  });

  it("carries the order id in the memo, which is what binds it to one order", async () => {
    const built = await buildFundLock(client, ESCROW, params);
    expect(built.memo).toBe(params.orderId);
    expect(decodeFundLock(built.transactionBytes).memo).toBe(params.orderId);
  });

  it("issues the 180-second window it promises, not Hedera's 120-second default", async () => {
    const built = await buildFundLock(client, ESCROW, params);
    const facts = decodeFundLock(built.transactionBytes);

    // The window the requester is told about has to be the window the
    // transaction actually has, or the client rebuilds too early or too late.
    expect(facts.validUntil).toBe(built.validUntil);
    expect(Date.parse(built.validUntil) - Date.now()).toBeGreaterThan(150_000);
    expect(Date.parse(built.validUntil) - Date.now()).toBeLessThanOrEqual(180_000);
  });

  it("refuses an order id that will not fit the memo, before anything is frozen", async () => {
    await expect(
      buildFundLock(client, ESCROW, { ...params, orderId: "a".repeat(101) }),
    ).rejects.toBeInstanceOf(FundLockError);
  });
});

describe("decodeFundLock reads what the requester signed", () => {
  it("reports no signer on bytes nobody signed", async () => {
    const built = await buildFundLock(client, ESCROW, params);
    expect(decodeFundLock(built.transactionBytes).signedBy).toHaveLength(0);
  });

  it("reports the signing public key once signed", async () => {
    const built = await buildFundLock(client, ESCROW, params);
    const facts = decodeFundLock(await sign(built.transactionBytes, REQUESTER_KEY));

    expect(facts.signedBy).toEqual([REQUESTER_KEY.publicKey.toStringRaw()]);
  });

  it("reports signers as opaque, because this server cannot name their account", async () => {
    const built = await buildFundLock(client, ESCROW, params);
    const facts = decodeFundLock(await sign(built.transactionBytes, OTHER_KEY));

    // A wrong signer is real, and it is consensus's to refuse with
    // INVALID_SIGNATURE — nothing moves. The whitelist may only count these.
    expect(facts.signerIdentity).toBe("opaque");
    expect(facts.signedBy).toEqual([OTHER_KEY.publicKey.toStringRaw()]);
  });

  it("refuses bytes that are not a Hedera transaction", () => {
    expect(() => decodeFundLock("bm90LWEtdHJhbnNhY3Rpb24=")).toThrow(FundLockError);
  });

  it("refuses a transaction that is not a transfer", async () => {
    // A transfer with no legs still parses as a TransferTransaction, so this
    // case needs a genuinely different transaction type.
    const frozen = new TopicMessageSubmitTransaction()
      .setTopicId("0.0.1234")
      .setMessage("x")
      .setTransactionId(TransactionId.generate(REQUESTER))
      .freezeWith(client);
    const other = await sign(Buffer.from(frozen.toBytes()).toString("base64"), REQUESTER_KEY);

    expect(() => decodeFundLock(other)).toThrow(
      expect.objectContaining({ reason: "not-a-transfer" }),
    );
  });

  it("survives a transfer carrying a rider leg, so the whitelist can refuse it", async () => {
    // The decoder must report every leg rather than the first two, or
    // extra-transfers becomes a rejection nothing can produce.
    const tampered = new TransferTransaction()
      .addHbarTransfer(REQUESTER, Hbar.fromTinybars("-20000000000"))
      .addHbarTransfer(ESCROW, Hbar.fromTinybars("10000000000"))
      .addHbarTransfer(AccountId.fromString("0.0.9999"), Hbar.fromTinybars("10000000000"))
      .setTransactionId(TransactionId.generate(REQUESTER))
      .setTransactionMemo(params.orderId)
      .freezeWith(client);

    const facts = decodeFundLock(
      await sign(Buffer.from(tampered.toBytes()).toString("base64"), REQUESTER_KEY),
    );
    expect(facts.transfers).toHaveLength(3);
  });
});
