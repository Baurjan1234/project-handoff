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

  async getSignedUrl(storageKey: string): Promise<string> {
    if (!this.#store.has(storageKey)) {
      throw new ContentStoreError(`no content stored under key ${storageKey}`);
    }
    return `memory://${storageKey}`;
  }

  /** Test-only escape hatch — reads the bytes back directly, no signed-URL indirection. */
  read(storageKey: string): Buffer | undefined {
    return this.#store.get(storageKey);
  }
}
