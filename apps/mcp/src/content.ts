/**
 * The content-store port this app needs, and a memory-backed stand-in.
 *
 * `packages/content` owns the real store and its Supabase implementation. That
 * package is P1's and does not exist yet, so this file states the shape we
 * consume rather than blocking on it: a store takes bytes we have already
 * hashed and hands back an opaque reference.
 *
 * Two rules from `packages/content/CLAUDE.md` are visible in the signature.
 * The store never hashes — hashing lives in `@handoff/schema` so that two
 * implementations agree on a hash — so the hash is an argument rather than a
 * return value. And the store holds the bytes while only the hash goes
 * on-chain, so nothing here is ever put in an envelope.
 *
 * At the cutover this port is satisfied by `@handoff/content` and
 * `InMemoryContentStore` becomes a test fixture.
 */

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
