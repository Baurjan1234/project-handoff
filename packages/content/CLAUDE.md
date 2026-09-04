# packages/content — the content store, behind an interface

**Owner: P1 Khishgee.**

## What this package owns

- A storage interface, and a Supabase implementation of it.
- Signed URL issuance, with a TTL longer than claim-timeout plus review time.
- An in-memory implementation for tests.

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
