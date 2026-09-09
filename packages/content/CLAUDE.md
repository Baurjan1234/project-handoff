# packages/content — the content store, behind an interface

**Owner: P1 Khishgee.**

## What this package owns

- A storage interface, and a Supabase implementation of it.
- Signed URL issuance, with a TTL longer than claim-timeout plus review time.
- An in-memory implementation for tests.
- **`readVerifiedByHash(adapter, expectedHash)`** — the hash-verified read the close
  reply depends on (NAS-37,
  `../../docs/decisions/2026-09-07-notes-read-lives-in-content-package.md`).

## The verified read, and what it does on a mismatch

`readVerifiedByHash` fetches the bytes, recomputes `sha256Hex` over what came back, and
**returns them only if the recomputed hash equals the hash asked for**. On a mismatch it
throws `ContentHashMismatchError` naming both hashes, and returns nothing — content that
doesn't match its on-chain commitment never reaches a caller, even as a "probably fine"
fallback.

It is a free function, not an adapter method, deliberately: verification is not something
a caller can forget or an adapter can implement slightly differently. `adapter.get()` is
the raw primitive underneath it — **use `readVerifiedByHash` for anything whose hash was
published on-chain**, and reach for `get()` only when there is no hash to check against.

Hashing itself is `@handoff/schema`'s, never this package's (see below). This function
verifies with it; it does not implement it. Notes come back as **bytes**, not a signed
URL, because the close reply inlines them and notes are small — signed URLs stay for
artifacts.

## What this package must never do

- **Never let content reach the chain.** This package holds the bytes; only the hash
  goes on-chain. That applies to the expert's written notes exactly as it applies to the
  artifact. `notes_hash`, never the text.
- **Never hash here.** Hashing lives in `@handoff/schema` so two implementations agree.
- **Never embed the service key.** It is vault-only and read from the environment on the
  server. Nothing here logs it.
- Never assume the store is durable in the way the chain is. Content availability is
  centralized behind one vendor this week. The on-chain hash is the commitment, and
  parties keep their own copies. Say that out loud rather than hiding it.
