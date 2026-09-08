/**
 * The content-store port this app needs, and a memory-backed stand-in.
 *
 * `packages/content` owns the real store and its Supabase implementation. That
 * package is P1's and does not exist yet, so this file states the shape we
 * consume rather than blocking on it: a store takes bytes we have already
 * hashed and hands back an opaque reference.
 *
 * One rule from `packages/content/CLAUDE.md` is visible in the signature: the
 * store holds the bytes while only the hash goes on-chain, so nothing here is
 * ever put in an envelope.
 *
 * The hash is an argument rather than a return value because this app hashes
 * first — the envelope is built from the hash and the store is told what to
 * file the bytes under. `@handoff/content` hashes too, with the same
 * `sha256Hex` from `@handoff/schema`, so `contentStore` below asserts the two
 * agree rather than trusting that they do. `InMemoryContentStore` is now a
 * test fixture, per the cutover rule.
 */

import type { ContentStoreAdapter } from "@handoff/content";

export interface ContentStore {
  /**
   * Store bytes under a hash the caller computed.
   *
   * @param hash - lowercase sha-256 hex of `bytes`, from `@handoff/schema`
   * @param bytes - the content itself, which never reaches a topic
   * @returns an opaque reference for fetching it back
   */
  put(hash: string, bytes: Uint8Array): Promise<string>;
}

export class InMemoryContentStore implements ContentStore {
  readonly #objects = new Map<string, Uint8Array>();

  async put(hash: string, bytes: Uint8Array): Promise<string> {
    // Content-addressed, so storing the same bytes twice is not an error and
    // not a second object. The real store gets the same property for free.
    this.#objects.set(hash, bytes);
    return `memory://${hash}`;
  }

  /** Test-only. */
  get(hash: string): Uint8Array | undefined {
    return this.#objects.get(hash);
  }

  /** Test-only. */
  get size(): number {
    return this.#objects.size;
  }
}

/**
 * The real store, as this app's port.
 *
 * `@handoff/content` owns the bytes and hashes them itself, returning the hash
 * it computed. This app hashed first, because the envelope needs the hash
 * before anything is stored. Both go through `sha256Hex` in `@handoff/schema`,
 * which is the whole reason hashing lives there — so the two must agree.
 *
 * They are checked anyway. Hard rule 1 is that the on-chain hash is the
 * commitment to the stored bytes; if the store filed them under a different
 * hash, the envelope points at nothing and the mismatch has to surface here,
 * before the order posts, rather than as an unfetchable artifact later.
 */
export function contentStore(adapter: ContentStoreAdapter): ContentStore {
  return {
    async put(hash: string, bytes: Uint8Array): Promise<string> {
      const stored = await adapter.put(Buffer.from(bytes));
      if (stored.contentHash !== hash) {
        throw new Error(
          `content store filed bytes under ${stored.contentHash}, but the envelope ` +
            `commits to ${hash}. Refusing to post an order whose hash points at ` +
            `nothing. Both sides must hash through sha256Hex in @handoff/schema.`,
        );
      }
      return stored.storageKey;
    },
  };
}
