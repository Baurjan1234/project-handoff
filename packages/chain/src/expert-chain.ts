/**
 * The expert's slice of the chain, for the expert app (`apps/web`).
 *
 * `apps/web/src/chain/adapter.ts` expects, at cutover, "the real adapter from
 * `packages/chain`, constructed with the expert's own account and key" — and only
 * the slice it is allowed to call: `network`, `submitMessage`, `readMessages`,
 * `getTransaction`. Not `signSchedule`, `createSchedule`, `deleteSchedule` or
 * `lockFunds`: **the expert's key signs the HCS message and nothing else.**
 * `HederaChainAdapter` is the wrong thing to hand a browser — it needs the escrow
 * account and both platform keys, none of which an expert has or should have.
 *
 * ## The key is held in a closure, on purpose
 *
 * `apps/web/CLAUDE.md` requires it: *"The adapter P1 returns must keep the key the
 * same way: in a closure or a WeakMap, never as an own property, because the adapter
 * itself does sit in state."*
 *
 * That rules out a class with the key on `this`. A TypeScript `private` field — and
 * a `private readonly` constructor parameter especially — is compile-time only; at
 * runtime it is an ordinary own property, reachable through `Object.keys`,
 * `JSON.stringify`, a React DevTools inspection, or an error serializer that walks
 * the object it was handed. `HederaChainAdapter` has exactly that shape
 * (`constructor(private readonly config)`), which is fine for a server-side process
 * and not fine for an object living in React state.
 *
 * So this is a factory returning a frozen object of closures. The key is captured in
 * scope and never assigned to the returned value. `Object.keys()` on the result
 * lists methods and nothing else, and that is asserted in the tests rather than
 * left as an intention.
 *
 * ## The key is checked against the account before a Client exists
 *
 * The connect screen already read the account's public key off the mirror node.
 * Handing it in as `expectedPublicKey` turns a wrong paste into a plain
 * `KeyMismatchError` at connect, instead of an `INVALID_SIGNATURE` at the first
 * submit, on a laptop that is about to be recorded. The error names the account
 * and never the key.
 */

import { AccountId, Client, PrivateKey, TopicId } from "@hiero-ledger/sdk";
import type { ChainAdapter, ConsensusRef, ReadMessagesOptions, TopicMessage, TransactionRecord } from "@handoff/schema";
import { submitTopicMessage } from "./hcs.js";
import { fetchMirrorTopicMessages, fetchMirrorTransaction } from "./mirror.js";

/** Exactly the slice the expert app may call. Mirrors apps/web's `ExpertChain`. */
export type ExpertChain = Pick<ChainAdapter, "network" | "submitMessage" | "readMessages" | "getTransaction">;

/** The two curves a Hedera account key can be. Named as the mirror node names them. */
export type ExpertKeyType = "ED25519" | "ECDSA_SECP256K1";

export interface ExpertChainParams {
  /** The expert's own account. They pay for and sign their own attestation. */
  accountId: string;
  /**
   * The expert's key as the connect screen collected it: the DER string from the
   * portal, or raw hex. Taken as a string rather than a `PrivateKey` so the caller
   * never has to hold a parsed key object either — this reads it once and keeps it
   * in scope. A raw hex key needs `keyType`, because 32 bytes do not say which
   * curve they are on.
   */
  privateKeyDer: string;
  /** Which curve to parse a raw key as. Ignored for DER, which carries its own. */
  keyType?: ExpertKeyType;
  /**
   * The account's public key as the mirror node reports it (hex, raw or DER).
   * When given, a key that does not produce it is refused with `KeyMismatchError`
   * before any `Client` is built.
   */
  expectedPublicKey?: string;
  mirrorNodeUrl: string;
}

/** The pasted key is not the one that controls the account. Says which account; never which key. */
export class KeyMismatchError extends Error {
  constructor(accountId: string) {
    super(`This key does not belong to account ${accountId}.`);
    this.name = "KeyMismatchError";
  }
}

function stripHexPrefix(text: string): string {
  return text.startsWith("0x") || text.startsWith("0X") ? text.slice(2) : text;
}

/**
 * DER carries the curve in its header (`302e…` ED25519, `3030…` ECDSA) and is
 * always longer than a raw 32-byte key, so the two cannot be confused: a raw key
 * is exactly 64 hex characters. The SDK's plain `fromString` is deprecated and
 * DER-only, so this never calls it.
 */
function parsePrivateKey(text: string, keyType: ExpertKeyType | undefined): PrivateKey {
  const hex = stripHexPrefix(text.trim());
  if (hex.length > 64 && /^30/i.test(hex)) return PrivateKey.fromStringDer(hex);
  if (keyType === "ECDSA_SECP256K1") return PrivateKey.fromStringECDSA(hex);
  if (keyType === "ED25519") return PrivateKey.fromStringED25519(hex);
  throw new Error("A raw hex key does not say which curve it is on. Pass keyType, or the DER form from the portal.");
}

function publicKeyMatches(privateKey: PrivateKey, expected: string): boolean {
  const wanted = stripHexPrefix(expected.trim()).toLowerCase();
  const publicKey = privateKey.publicKey;
  return wanted === publicKey.toStringRaw().toLowerCase() || wanted === publicKey.toStringDer().toLowerCase();
}

/**
 * Builds the expert's chain. Testnet only — there is no network parameter, because
 * hard rule 5 leaves nothing to choose.
 *
 * The returned object owns the `Client` it creates. Call `close()` on disconnect;
 * the expert app's connect screen is the thing that knows when that is.
 */
export function createExpertChain(params: ExpertChainParams): ExpertChain & { close: () => void } {
  const accountId = AccountId.fromString(params.accountId);

  // Read once, into scope. Never stored on the returned object.
  const privateKey = parsePrivateKey(params.privateKeyDer, params.keyType);

  if (params.expectedPublicKey !== undefined && !publicKeyMatches(privateKey, params.expectedPublicKey)) {
    throw new KeyMismatchError(params.accountId);
  }

  const client = Client.forTestnet();
  client.setOperator(accountId, privateKey);

  const mirrorNodeUrl = params.mirrorNodeUrl;

  // Frozen object of closures. The key is reachable only through these functions.
  return Object.freeze({
    network: "testnet" as const,

    /**
     * Publishes from the expert's own account — they are the client's operator, so
     * they are the payer, and the payer account is what readers take the author from.
     */
    async submitMessage(topicId: string, contents: string): Promise<ConsensusRef> {
      const result = await submitTopicMessage(client, TopicId.fromString(topicId), contents);
      return {
        transactionId: result.transactionId,
        consensusTimestamp: result.result.consensusTimestamp,
        sequenceNumber: Number(result.result.topicSequenceNumber),
      };
    },

    async readMessages(topicId: string, options: ReadMessagesOptions = {}): Promise<readonly TopicMessage[]> {
      const messages = await fetchMirrorTopicMessages(mirrorNodeUrl, topicId, {
        order: "asc",
        ...(options.afterSequenceNumber !== undefined ? { afterSequenceNumber: options.afterSequenceNumber } : {}),
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
      });

      return messages.map((m) => ({
        topicId,
        sequenceNumber: m.sequence_number,
        consensusTimestamp: m.consensus_timestamp,
        payerAccountId: m.payer_account_id,
        contents: m.message,
      }));
    },

    async getTransaction(transactionId: string): Promise<TransactionRecord | null> {
      const tx = await fetchMirrorTransaction(mirrorNodeUrl, transactionId);
      if (!tx) return null;
      return {
        transactionId: tx.transaction_id,
        status: tx.result === "SUCCESS" ? "SUCCESS" : "FAILED",
        consensusTimestamp: tx.consensus_timestamp,
      };
    },

    close(): void {
      client.close();
    },
  });
}
