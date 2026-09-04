# packages/schema — the treaty

**Owner: P4 Nasaa.** Changes here are a pull request tagged `breaking` and announced at
the sync, because every other lane compiles against this package.

## What this package owns

- The zod schemas for the order envelope and the attestation.
- `SCHEMA_VERSION` and every bound: HCS message size, `defects[]` limits.
- The money module. Tinybars as `bigint`, strings at every boundary.
- Canonical serialization and hashing, so two implementations agree on a hash.
- The `ChainAdapter` interface and `MockChainAdapter`.

## What this package must never do

- **Never import the Hedera SDK.** Only `packages/chain` does. This package describes
  the shape of the world; it does not talk to a network.
- **Never touch a key, a private key, or an environment variable.** Nothing here reads
  `process.env`.
- **Never convert money anywhere but the money module.** If you find yourself writing
  `/ 100000000` outside `money.ts`, stop.
- **Never use `any` or `@ts-ignore`.** This is money-path code by definition.
- Never do I/O. No `fs`, no `fetch`. `node:crypto` for hashing is the one exception.

## Rules that live here as code, not comments

- `review` sets `artifact_hash_in` and never `artifact_hash_out`. `execution` sets
  `artifact_hash_out`, plus `_in` when an input existed. This is a discriminated union
  with strict objects, so the wrong shape cannot be constructed or parsed.
- An attestation must fit in a single HCS message. Check it, do not assume it.
- Money never becomes a `number`. Not for display, not for comparison, not once.

## The cutover

`MockChainAdapter` exists so P2 and P3 can build from hour one. After the Monday-night
cutover it is a test fixture only and never appears in a demo or a recording.
