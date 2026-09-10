/**
 * The content-store port the expert app consumes.
 *
 * Same shape as the one `apps/mcp` states, on purpose: `@handoff/content`
 * satisfies both on the server, and until the cutover a memory-backed stand-in
 * does here. The store never hashes; the caller hashes through the schema
 * package and hands the hash in, so that what is stored is exactly what was
 * committed to.
 *
 * The expert's written notes go through here. Only their hash goes to a topic.
 * The task description and the document under review come back out of here,
 * by the hashes the envelope committed to.
 *
 * In the browser the store is an HTTP one, because the Supabase service key
 * is vault-only and server-side: the app never holds it, so it talks to
 * whatever does. Every read is checked against the hash it asked for, the same
 * rule as `readVerifiedByHash` in `@handoff/content`: bytes that do not hash
 * to their on-chain commitment never reach a screen.
 */

import { sha256HexOfBytes } from "./sign/notes";

export interface ContentStore {
  /**
   * Store bytes under a hash the caller computed.
   *
   * @param hash - lowercase sha-256 hex of `bytes`
   * @param bytes - the content itself, which never reaches a topic
   * @returns an opaque reference for fetching it back
   */
  put(hash: string, bytes: Uint8Array): Promise<string>;

  /** The bytes behind a hash, or null when the store has nothing for it. */
  get(hash: string): Promise<Uint8Array | null>;
}

export class InMemoryContentStore implements ContentStore {
  readonly #objects = new Map<string, Uint8Array>();

  async put(hash: string, bytes: Uint8Array): Promise<string> {
    this.#objects.set(hash, bytes);
    return `memory://${hash}`;
  }

  async get(hash: string): Promise<Uint8Array | null> {
    return this.#objects.get(hash) ?? null;
  }

  /** Test-only. */
  get size(): number {
    return this.#objects.size;
  }
}

/** What came back does not hash to what was asked for. Never handed over. */
export class ContentMismatch extends Error {
  constructor(
    readonly expectedHash: string,
    readonly actualHash: string,
  ) {
    super("The content store returned something that does not match its fingerprint. It was not used.");
    this.name = "ContentMismatch";
  }
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Content over HTTP, addressed by hash: `GET {base}/{sha256}` returns the
 * bytes, `PUT {base}/{sha256}` stores them. The base is configuration
 * (`VITE_CONTENT_URL`); what answers it holds the store's credentials, and
 * this class holds none.
 */
export class HttpContentStore implements ContentStore {
  readonly #base: string;
  readonly #fetch: typeof fetch;

  constructor(baseUrl: string, fetchImpl: typeof fetch = (input, init) => fetch(input, init)) {
    this.#base = baseUrl.replace(/\/+$/, "");
    this.#fetch = fetchImpl;
  }

  #url(hash: string): string {
    if (!SHA256_HEX.test(hash)) throw new Error("Not a content hash.");
    return `${this.#base}/${hash}`;
  }

  async put(hash: string, bytes: Uint8Array): Promise<string> {
    const url = this.#url(hash);
    const body = new Uint8Array(bytes);
    const response = await this.#fetch(url, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body,
    });
    if (!response.ok) throw new Error(`The content store did not take the notes (${response.status}).`);
    return url;
  }

  async get(hash: string): Promise<Uint8Array | null> {
    const response = await this.#fetch(this.#url(hash));
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`The content store answered ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const actual = await sha256HexOfBytes(bytes);
    if (actual !== hash) throw new ContentMismatch(hash, actual);
    return bytes;
  }
}
