import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sha256Hex } from "@handoff/schema";

/**
 * Content-store adapter interface (hard rule 1: content never goes on-chain, only
 * its hash).
 */
export interface ContentStoreAdapter {
  /** Stores content, returns its hash (the value that goes on-chain) and a storage key. */
  put(content: Buffer): Promise<{ contentHash: string; storageKey: string }>;
  /**
   * The raw bytes back. Prefer `readVerifiedByHash` over calling this directly for
   * anything whose hash is published on-chain — it's the primitive, not the read a
   * caller should reach for.
   */
  get(storageKey: string): Promise<Buffer>;
  /**
   * A signed, time-limited URL for reading the content back. TTL must exceed
   * claim-timeout + review time — enforce that at the call site with
   * assertSignedUrlTtlSufficient below, since this interface doesn't know the
   * order's claim-timeout on its own.
   */
  getSignedUrl(storageKey: string, ttlSeconds: number): Promise<string>;
}

export class ContentStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentStoreError";
  }
}

/** The stored bytes don't hash to the hash they were asked for. Never return them anyway. */
export class ContentHashMismatchError extends ContentStoreError {
  constructor(
    readonly expectedHash: string,
    readonly actualHash: string,
  ) {
    super(
      `content does not match its hash: asked for ${expectedHash}, stored bytes hash to ${actualHash}. ` +
        `Refusing to return content that doesn't match the on-chain commitment.`,
    );
    this.name = "ContentHashMismatchError";
  }
}

/**
 * The hash-verified read (NAS-37, decided in
 * ../../../docs/decisions/2026-09-07-notes-read-lives-in-content-package.md): fetch by
 * the hash that was published on-chain, recompute it from the bytes that came back,
 * and hand those bytes over only if the two agree.
 *
 * Returns bytes, not a signed URL — the close reply inlines the expert's notes, and
 * notes are small. Signed URLs stay for artifacts.
 *
 * This is a free function rather than an adapter method on purpose: the verification
 * is not something a caller can forget or an adapter can implement slightly
 * differently. Hashing itself lives in `@handoff/schema` so two implementations
 * agree; this only verifies with it.
 */
export async function readVerifiedByHash(adapter: ContentStoreAdapter, expectedHash: string): Promise<Buffer> {
  const bytes = await adapter.get(expectedHash);
  const actualHash = sha256Hex(bytes);

  if (actualHash !== expectedHash) {
    throw new ContentHashMismatchError(expectedHash, actualHash);
  }

  return bytes;
}

/**
 * NAS-15: "signed URL TTL must exceed claim-timeout plus review time, or an expert
 * loses access mid-review." Call this wherever a TTL is chosen, before issuing it —
 * not inside a specific adapter, so every adapter (local, in-memory, Supabase) gets
 * the same guard for free.
 */
export function assertSignedUrlTtlSufficient(ttlSeconds: number, claimTimeoutSeconds: number, reviewTimeSeconds: number): void {
  const required = claimTimeoutSeconds + reviewTimeSeconds;
  if (ttlSeconds < required) {
    throw new ContentStoreError(
      `signed URL TTL ${ttlSeconds}s is shorter than claim-timeout + review time (${required}s) — an expert could lose access mid-review`,
    );
  }
}

/** Local filesystem adapter — dev + the deterministic demo fallback, never the recorded run. */
export class LocalDevContentAdapter implements ContentStoreAdapter {
  constructor(private readonly rootDir: string) {}

  async put(content: Buffer): Promise<{ contentHash: string; storageKey: string }> {
    // Bare hex, matching @handoff/schema's sha256Hex and its Sha256Hex zod schema
    // (primitives.ts: /^[0-9a-f]{64}$/) — confirmed, not a guess: no "sha256:" prefix.
    const hash = sha256Hex(content);
    const filePath = join(this.rootDir, hash);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
    return { contentHash: hash, storageKey: hash };
  }

  async get(storageKey: string): Promise<Buffer> {
    try {
      return await readFile(join(this.rootDir, storageKey));
    } catch {
      throw new ContentStoreError(`no content stored under key ${storageKey}`);
    }
  }

  async getSignedUrl(storageKey: string): Promise<string> {
    const filePath = join(this.rootDir, storageKey);
    await readFile(filePath); // throws if missing, mirroring a real adapter's 404
    return `file://${filePath}`;
  }
}

/**
 * In-memory adapter — NAS-15 asks for one specifically for tests: no disk I/O, no
 * cleanup between test runs beyond dropping the instance. Never for the demo or a
 * recording, same rule as LocalDevContentAdapter, for the same reason (nothing here
 * is a real Hedera-adjacent artifact store).
 */
export class InMemoryContentAdapter implements ContentStoreAdapter {
  readonly #store = new Map<string, Buffer>();

  async put(content: Buffer): Promise<{ contentHash: string; storageKey: string }> {
    const hash = sha256Hex(content);
    this.#store.set(hash, content);
    return { contentHash: hash, storageKey: hash };
  }

  async get(storageKey: string): Promise<Buffer> {
    const bytes = this.#store.get(storageKey);
    if (!bytes) {
      throw new ContentStoreError(`no content stored under key ${storageKey}`);
    }
    return bytes;
  }

  async getSignedUrl(storageKey: string): Promise<string> {
    if (!this.#store.has(storageKey)) {
      throw new ContentStoreError(`no content stored under key ${storageKey}`);
    }
    return `memory://${storageKey}`;
  }

  /** Test-only: plant bytes under a key they do NOT hash to, so the verified read's refusal can be tested. */
  putRaw(storageKey: string, content: Buffer): void {
    this.#store.set(storageKey, content);
  }

  /** Test-only escape hatch — reads the bytes back directly, no signed-URL indirection. */
  read(storageKey: string): Buffer | undefined {
    return this.#store.get(storageKey);
  }
}
