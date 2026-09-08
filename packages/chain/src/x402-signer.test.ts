/**
 * Offline tests. Nothing here touches the network: an ECDSA key is generated in
 * process, and the payload is decoded and taken apart with the SDK.
 *
 * The live proof is a different thing entirely — `apps/mcp/scripts/smoke-402.sh`
 * against Blocky402 — and it is what actually closes NAS-16.
 */

import { AccountId, PrivateKey, Transaction, TransferTransaction } from "@hiero-ledger/sdk";
import { describe, expect, it } from "vitest";
import {
  PAYMENT_SIGNATURE_HEADER,
  X402_HBAR_ASSET,
  X402_NETWORK,
  X402Signer,
  X402SignerError,
} from "./x402-signer.js";
import type { X402PaymentRequirements } from "./x402-signer.js";

const PAYER = "0.0.10376667";
const RECEIVER = "0.0.5550001";
/** Blocky402's own signer on testnet, from the measured `/supported`. */
const FEE_PAYER = "0.0.7162784";
const SERVICE_URL = "http://localhost:4021/orders";

const CAP = "100000000"; // 1 HBAR
const FEE = "50000000"; // 0.5 HBAR, the ratified per-call fee

function requirements(overrides: Partial<X402PaymentRequirements> = {}): X402PaymentRequirements {
  return {
    scheme: "exact",
    network: X402_NETWORK,
    amount: FEE,
    payTo: RECEIVER,
    maxTimeoutSeconds: 300,
    asset: X402_HBAR_ASSET,
    extra: { feePayer: FEE_PAYER },
    ...overrides,
  };
}

function signer(overrides: { privateKey?: PrivateKey; maxAmountTinybars?: string } = {}): X402Signer {
  return new X402Signer({
    accountId: PAYER,
    resourceUrl: SERVICE_URL,
    privateKey: overrides.privateKey ?? PrivateKey.generateECDSA(),
    maxAmountTinybars: overrides.maxAmountTinybars ?? CAP,
  });
}

function decode(headerValue: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(headerValue, "base64").toString("utf8")) as Record<string, unknown>;
}

describe("X402Signer construction", () => {
  it("refuses an Ed25519 key, naming the key type rather than the signature", () => {
    expect(() => signer({ privateKey: PrivateKey.generateED25519() })).toThrow(X402SignerError);
    expect(() => signer({ privateKey: PrivateKey.generateED25519() })).toThrow(/ECDSA/);
  });

  it("refuses a cap that is not a positive tinybar amount", () => {
    expect(() => signer({ maxAmountTinybars: "0" })).toThrow();
    expect(() => signer({ maxAmountTinybars: "1.5" })).toThrow();
    expect(() => signer({ maxAmountTinybars: "not a number" })).toThrow();
  });

  it("keeps the cap and the account as strings", () => {
    const s = signer();
    expect(s.accountId).toBe(PAYER);
    expect(s.maxAmountTinybars).toBe(CAP);
  });
});

describe("X402Signer.sign", () => {
  it("returns the whole envelope, with the quote echoed back verbatim", async () => {
    const quoted = requirements();
    const decoded = decode(await signer().sign(quoted));

    expect(decoded["x402Version"]).toBe(2);
    // The facilitator rejects anything but the requirements it quoted, before
    // it looks at the transaction at all.
    expect(decoded["accepted"]).toEqual(quoted);
    expect((decoded["payload"] as { transaction: string }).transaction.length).toBeGreaterThan(0);
  });

  it("signs a TransferTransaction that debits the payer and credits payTo", async () => {
    const decoded = decode(await signer().sign(requirements()));
    const bytes = Buffer.from((decoded["payload"] as { transaction: string }).transaction, "base64");
    const tx = Transaction.fromBytes(bytes);

    expect(tx).toBeInstanceOf(TransferTransaction);
    const transfers = (tx as TransferTransaction).hbarTransfers;
    expect(transfers.get(AccountId.fromString(PAYER))?.toTinybars().toString()).toBe(`-${FEE}`);
    expect(transfers.get(AccountId.fromString(RECEIVER))?.toTinybars().toString()).toBe(FEE);
  });

  it("makes the facilitator the fee payer, so the client pays no gas", async () => {
    const decoded = decode(await signer().sign(requirements()));
    const bytes = Buffer.from((decoded["payload"] as { transaction: string }).transaction, "base64");
    const tx = Transaction.fromBytes(bytes);

    // The transaction id names the account that pays the Hedera fee. It is the
    // facilitator's, not ours — that is what "designated fee payer" means.
    expect(tx.transactionId?.accountId?.toString()).toBe(FEE_PAYER);
  });

  it("carries the payer's signature already", async () => {
    const key = PrivateKey.generateECDSA();
    const decoded = decode(await signer({ privateKey: key }).sign(requirements()));
    const bytes = Buffer.from((decoded["payload"] as { transaction: string }).transaction, "base64");
    const tx = Transaction.fromBytes(bytes);

    // getSignatures() nests three deep: node account, then transaction id, then
    // the public keys that signed. Measured, not assumed.
    const signers = [...tx.getSignatures().values()]
      .flatMap((byTransactionId) => [...byTransactionId.values()])
      .flatMap((byPublicKey) => [...byPublicKey.keys()])
      .map((publicKey) => publicKey.toString());

    expect(signers).toContain(key.publicKey.toString());
  });

  it("refuses a network that is not testnet", async () => {
    await expect(signer().sign(requirements({ network: "hedera:mainnet" }))).rejects.toThrow(
      X402SignerError,
    );
  });

  it("refuses a token, because a token needs an association first", async () => {
    await expect(signer().sign(requirements({ asset: "0.0.456858" }))).rejects.toThrow(/HBAR/);
  });

  it("refuses an amount that is not a whole positive tinybar figure", async () => {
    await expect(signer().sign(requirements({ amount: "0.5" }))).rejects.toThrow();
    await expect(signer().sign(requirements({ amount: "0" }))).rejects.toThrow();
    await expect(signer().sign(requirements({ amount: "" }))).rejects.toThrow();
  });

  it("refuses a quote over the cap rather than signing what it was handed", async () => {
    const over = requirements({ amount: "100000001" });
    await expect(signer().sign(over)).rejects.toThrow(X402SignerError);
    await expect(signer().sign(over)).rejects.toThrow(/caps a payment/);
  });

  it("signs exactly at the cap", async () => {
    const decoded = decode(await signer().sign(requirements({ amount: CAP })));
    expect((decoded["accepted"] as { amount: string }).amount).toBe(CAP);
  });

  it("names the version 2 header, not the version 1 one", () => {
    expect(PAYMENT_SIGNATURE_HEADER).toBe("PAYMENT-SIGNATURE");
  });
});
