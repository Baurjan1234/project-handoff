import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertSignedUrlTtlSufficient, ContentStoreError, InMemoryContentAdapter, LocalDevContentAdapter } from "./adapter.js";

describe("LocalDevContentAdapter", () => {
  it("round-trips put -> signed URL -> read, hash is bare hex", async () => {
    const dir = await mkdtemp(join(tmpdir(), "handoff-content-"));
    try {
      const adapter = new LocalDevContentAdapter(dir);
      const content = Buffer.from("fake artifact, labeled FAKE per hard rule 7");
      const { contentHash, storageKey } = await adapter.put(content);

      expect(contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(storageKey).toBe(contentHash);

      const url = await adapter.getSignedUrl(storageKey);
      expect(url.startsWith("file://")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is deterministic — same bytes, same hash", async () => {
    const dir = await mkdtemp(join(tmpdir(), "handoff-content-"));
    try {
      const adapter = new LocalDevContentAdapter(dir);
      const a = await adapter.put(Buffer.from("same content"));
      const b = await adapter.put(Buffer.from("same content"));
      expect(a.contentHash).toBe(b.contentHash);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("getSignedUrl throws for a missing object, mirroring a real 404", async () => {
    const dir = await mkdtemp(join(tmpdir(), "handoff-content-"));
    try {
      const adapter = new LocalDevContentAdapter(dir);
      await expect(adapter.getSignedUrl("does-not-exist")).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("InMemoryContentAdapter", () => {
  it("round-trips put -> signed URL -> read, no disk I/O", async () => {
    const adapter = new InMemoryContentAdapter();
    const content = Buffer.from("fake artifact, labeled FAKE per hard rule 7");
    const { contentHash, storageKey } = await adapter.put(content);

    expect(contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(storageKey).toBe(contentHash);

    const url = await adapter.getSignedUrl(storageKey);
    expect(url).toBe(`memory://${storageKey}`);
    expect(adapter.read(storageKey)).toEqual(content);
  });

  it("getSignedUrl throws for a missing key, mirroring a real 404", async () => {
    const adapter = new InMemoryContentAdapter();
    await expect(adapter.getSignedUrl("does-not-exist")).rejects.toThrow(ContentStoreError);
  });
});

describe("assertSignedUrlTtlSufficient", () => {
  it("accepts a TTL that comfortably covers claim-timeout + review time", () => {
    expect(() => assertSignedUrlTtlSufficient(3600, 900, 1800)).not.toThrow();
  });

  it("throws when the TTL would expire before claim-timeout + review time does", () => {
    expect(() => assertSignedUrlTtlSufficient(1000, 900, 1800)).toThrow(ContentStoreError);
  });

  it("throws exactly at the boundary minus one second", () => {
    expect(() => assertSignedUrlTtlSufficient(2699, 900, 1800)).toThrow(ContentStoreError);
    expect(() => assertSignedUrlTtlSufficient(2700, 900, 1800)).not.toThrow();
  });
});
