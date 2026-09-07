import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sha256Hex } from "@handoff/schema";
import { ContentStoreError, type ContentStoreAdapter } from "./adapter.js";

/**
 * The real content-store adapter for NAS-15. Untested against a live project — the
 * Supabase project itself is infra (sign up, create the project, create the bucket,
 * generate a service-role key) that has to happen once, out of band, by a human;
 * this class is what talks to it once that exists.
 *
 * The service key is vault-only and read from the environment on the server
 * (CLAUDE.md / packages/content/CLAUDE.md) — this class takes it as a constructor
 * argument rather than reading `process.env` itself, so the vault-vs-.env decision
 * stays entirely with the caller.
 */
export interface SupabaseContentAdapterConfig {
  url: string;
  /** Service-role key. Never the anon key — this adapter needs to write. Vault-only. */
  serviceKey: string;
  bucket: string;
}

export class SupabaseContentAdapter implements ContentStoreAdapter {
  private readonly client: SupabaseClient;

  constructor(private readonly config: SupabaseContentAdapterConfig) {
    this.client = createClient(config.url, config.serviceKey);
  }

  async put(content: Buffer): Promise<{ contentHash: string; storageKey: string }> {
    const hash = sha256Hex(content);

    // upsert: true — content is addressed by its own hash, so re-uploading identical
    // bytes under the same key is a no-op in effect, not a conflict to reject.
    const { error } = await this.client.storage.from(this.config.bucket).upload(hash, content, {
      upsert: true,
      contentType: "application/octet-stream",
    });

    if (error) {
      throw new ContentStoreError(`Supabase upload failed for ${hash}: ${error.message}`);
    }

    return { contentHash: hash, storageKey: hash };
  }

  async getSignedUrl(storageKey: string, ttlSeconds: number): Promise<string> {
    const { data, error } = await this.client.storage.from(this.config.bucket).createSignedUrl(storageKey, ttlSeconds);

    if (error || !data) {
      throw new ContentStoreError(`Supabase signed URL failed for ${storageKey}: ${error?.message ?? "no data returned"}`);
    }

    return data.signedUrl;
  }
}
