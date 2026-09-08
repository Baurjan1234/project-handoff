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
 */

import { AccountId, Client, PrivateKey, TopicId } from "@hiero-ledger/sdk";
import type { ChainAdapter, ConsensusRef, ReadMessagesOptions, TopicMessage, TransactionRecord } from "@handoff/schema";
import { submitTopicMessage } from "./hcs.js";
import { fetchMirrorTopicMessages, fetchMirrorTransaction } from "./mirror.js";

/** Exactly the slice the expert app may call. Mirrors apps/web's `ExpertChain`. */
export type ExpertChain = Pick<ChainAdapter, "network" | "submitMessage" | "readMessages" | "getTransaction">;

export interface ExpertChainParams {
  /** The expert's own account. They pay for and sign their own attestation. */
  accountId: string;
  /**
   * The expert's key, as the DER string the connect screen collected. Taken as a
   * string rather than a `PrivateKey` so the caller never has to hold a parsed key
   * object either — this reads it once and keeps it in scope.
   */
  privateKeyDer: string;
  mirrorNodeUrl: string;
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
  const privateKey = PrivateKey.fromString(params.privateKeyDer);

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
