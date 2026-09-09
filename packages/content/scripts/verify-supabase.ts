/**
 * Verifies the live Supabase project against SupabaseContentAdapter: lists buckets,
 * creates the content bucket if it's missing, then does a real put -> signed URL ->
 * fetch round trip. Prints no secrets.
 *
 * Run: node --env-file=../../.env $(which npx) tsx scripts/verify-supabase.ts
 */
import { createClient } from "@supabase/supabase-js";
import { ContentHashMismatchError, readVerifiedByHash } from "../src/adapter.ts";
import { SupabaseContentAdapter } from "../src/supabase-adapter.ts";

const BUCKET = process.env["SUPABASE_BUCKET"] ?? "handoff-content";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name} — fill it in .env`);
  return value;
}

async function main(): Promise<void> {
  const url = requireEnv("SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_KEY");

  console.log(`project host: ${new URL(url).host}`);
  console.log(`bucket: ${BUCKET}`);

  const admin = createClient(url, serviceKey);

  // 1. Can we authenticate at all?
  const { data: buckets, error: listError } = await admin.storage.listBuckets();
  if (listError) {
    throw new Error(`listBuckets failed — credentials or permissions problem: ${listError.message}`);
  }
  console.log(`\nauthenticated. existing buckets: ${buckets.map((b) => b.name).join(", ") || "(none)"}`);

  // 2. Create the bucket if it isn't there. Private — content is reached by signed URL only.
  if (!buckets.some((b) => b.name === BUCKET)) {
    const { error: createError } = await admin.storage.createBucket(BUCKET, { public: false });
    if (createError) {
      throw new Error(`createBucket failed: ${createError.message}`);
    }
    console.log(`created bucket ${BUCKET} (private)`);
  } else {
    console.log(`bucket ${BUCKET} already exists`);
  }

  // 3. Real round trip through the adapter the repo actually uses.
  const adapter = new SupabaseContentAdapter({ url, serviceKey, bucket: BUCKET });
  const content = Buffer.from(`FAKE demo artifact, written by verify-supabase at ${new Date().toISOString()}`);

  const { contentHash, storageKey } = await adapter.put(content);
  console.log(`\nput ok. contentHash: ${contentHash}`);

  const signedUrl = await adapter.getSignedUrl(storageKey, 3600);
  console.log(`signed URL issued (host ${new URL(signedUrl).host}, ttl 3600s)`);

  const response = await fetch(signedUrl);
  if (!response.ok) {
    throw new Error(`signed URL fetch failed: ${response.status}`);
  }
  const roundTripped = Buffer.from(await response.arrayBuffer());
  const identical = roundTripped.equals(content);
  console.log(`fetched back through the signed URL: ${response.status}, bytes identical: ${identical}`);

  if (!identical) {
    throw new Error("round-tripped bytes differ from what was uploaded");
  }

  // 4. The hash-verified read the close reply depends on (NAS-37), against the live store.
  const verified = await readVerifiedByHash(adapter, contentHash);
  console.log(`\nreadVerifiedByHash ok: ${verified.equals(content)} (bytes match, hash recomputed and checked)`);

  // 5. And it must refuse a hash the stored bytes don't produce.
  const wrongHash = "0".repeat(64);
  try {
    await readVerifiedByHash(adapter, wrongHash);
    throw new Error("readVerifiedByHash returned content for a hash it should not match");
  } catch (error) {
    const refusedCorrectly = error instanceof ContentHashMismatchError || /download failed|no content/i.test(String(error));
    console.log(`readVerifiedByHash refuses a non-matching hash: ${refusedCorrectly}`);
    if (!refusedCorrectly) throw error;
  }

  console.log("\nSupabase content store verified end to end.");
}

main().catch((error: unknown) => {
  console.error("\n=== FAILED ===");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
