/**
 * The one place the expert app picks a chain, now from a connection.
 *
 * Mock until the Monday-night cutover, then the real adapter from
 * `packages/chain`, constructed with the expert's own account and key. Both
 * satisfy the same `ChainAdapter` interface, so the sign action does not
 * change; only this file does. Nothing in this app imports the Hedera SDK.
 *
 * Two rules are types here rather than prose. `ExpertChain` is the slice of
 * the adapter the expert app is allowed to call: the expert's key signs the
 * HCS message and nothing else, so the sign path's type has no `signSchedule`,
 * `createSchedule`, `deleteSchedule` or `lockFunds`. And the mock member of
 * `WebChain` is the only one that carries the whole adapter, under a field
 * named for what it is, because only the mock plays the requester and the
 * platform as well.
 */

import { MockChainAdapter, type ChainAdapter } from "@handoff/schema";
import { InMemoryContentStore, type ContentStore } from "../content";
import type { ExpertConnection } from "../session/connect";
import type { WebChainConfig } from "./config";

export type ExpertChain = Pick<ChainAdapter, "network" | "submitMessage" | "readMessages" | "getTransaction">;

interface Connected {
  /** The account this chain signs as. From the connect screen, never the environment. */
  readonly expertAccountId: string;
  /** Signs as the expert, and as nobody else. */
  readonly chain: ExpertChain;
  readonly content: ContentStore;
  /** Idempotent. Drops whatever the adapter holds, including the key. */
  disconnect(): void;
}

export interface MockWebChain extends Connected {
  readonly mode: "mock";
  /** MOCK ONLY. The whole adapter, for the stand-in requester and platform. */
  readonly mock: MockChainAdapter;
}

export interface TestnetWebChain extends Connected {
  readonly mode: "testnet";
}

export type WebChain = MockWebChain | TestnetWebChain;

export class ConnectionMismatch extends Error {
  constructor(configured: string, connected: string) {
    super(`The app is configured for ${configured} but the connection is for ${connected}.`);
    this.name = "ConnectionMismatch";
  }
}

export function createWebChain(config: WebChainConfig, connection: ExpertConnection): WebChain {
  if (config.mode !== connection.mode) throw new ConnectionMismatch(config.mode, connection.mode);

  switch (connection.mode) {
    case "mock": {
      const mock = new MockChainAdapter();
      return {
        mode: "mock",
        expertAccountId: connection.accountId,
        chain: mock,
        mock,
        content: new InMemoryContentStore(),
        disconnect() {},
      };
    }
    case "testnet":
      // Thrown before the key is read: nothing here can use it yet, so nothing
      // reads it. Not a silent fallback to the mock, either: a screen that
      // says "testnet" while showing mock ids is what the recording rule
      // forbids. The credential is disposed by the caller either way.
      throw new Error(
        "The testnet adapter arrives with packages/chain at the Mon Sep 7 cutover. " +
          "Until then run with VITE_CHAIN=mock, and never record it.",
      );
  }
}
