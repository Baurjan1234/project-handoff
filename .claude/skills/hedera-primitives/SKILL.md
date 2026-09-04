---
name: hedera-primitives
description: Facts and lookup discipline for Hedera work on this project. Use whenever touching the Hedera SDK, HCS topics or messages, scheduled transactions, ScheduleCreate/ScheduleSign/ScheduleDelete, threshold or multi-signature keys, escrow accounts, mirror node reads, transaction IDs, consensus timestamps, account key types, or anything under packages/chain.
---

# Hedera primitives

## The rule that comes before any code

**Never recall a Hedera SDK call from memory.** Hallucinated SDK calls are the failure
mode the project audits named, and two servers exist specifically to close it.

- Hedera anything: search the `hedera-docs` server first.
- Everything else, meaning Next.js, Tailwind, shadcn, Supabase, the MCP SDK, zod,
  vitest: `context7`.

If a documentation search returns a large amount of text, that belongs in a subagent, not
in the main session. Bring back the conclusion.

## Already verified, do not re-derive

The full note with sources is `docs/research/hedera-primitives-verified.md`. The operative
facts:

**Scheduled transactions**

- `ScheduleCreate` carries a fully formed inner transaction. **The payee must be known**,
  so the schedule is created at claim time, not at post time. This is settled.
- `adminKey` is optional and we require it. Without it the schedule is immutable and
  `ScheduleDelete` is impossible, which removes both the claim-timeout path and the
  violation clawback.
- `waitForExpiry` defaults to false, so a schedule executes as soon as signatures satisfy
  the requirement. **That already is early-execute.** Do not build a second mechanism.
- `IDENTICAL_SCHEDULE_ALREADY_CREATED` returns the existing schedule ID. That is the
  idempotency primitive behind never double-paying. Use it rather than your own
  bookkeeping.
- Expiry is contested between two doc pages, thirty minutes in the protobuf reference
  against a settable value up to sixty-two days in core concepts. Confirm on testnet
  before the order deadline depends on it.
- Watch for `UNRESOLVABLE_REQUIRED_SIGNERS` and `SCHEDULE_ALREADY_DELETED` on the retry
  path.

**Consensus service**

- A message is capped at **1024 bytes**; a whole transaction at 6 KB. The SDK will chunk,
  but a chunked attestation is a worse artifact than a bounded one, so keep it to one
  message and let the schema bounds enforce it.
- `submitKey` decides who may write, and the answer differs per topic. Orders and
  attestations have **no submit key**, because experts submit from their own accounts and
  a submit key would put us in the signing path. The registry topic **has one**.

**Mirror node**

- Base `https://testnet.mirrornode.hedera.com`. Read-only, no auth, no fees.
- `GET /api/v1/topics/{id}/messages`, plus by sequence number or consensus timestamp, and
  `GET /api/v1/transactions/{id}`.
- Messages are **base64 by default**; pass `encoding=utf-8` for plaintext. `limit`
  defaults to 25 and `order` to ascending. Page through `links.next`.
- Hedera's own tutorial sleeps **six seconds** after a submit before querying. Design for
  that. Do not put a Hashscan link on the critical path of a ninety-second demo.

**Keys**

- A 2-of-3 escrow key is `new KeyList([a, b, c], 2)`. Without a threshold a `KeyList` is
  M-of-M.
- The x402 signer must be **ECDSA**. Check the key type when creating a testnet account
  rather than assuming the portal default. The escrow key list has no such constraint.

## Non-negotiables while writing this code

- **Only `packages/chain` imports the Hedera SDK.** Everything else goes through the
  `ChainAdapter` interface that `packages/schema` owns. That interface is what makes the
  Monday cutover a one-line swap.
- **Testnet only.** No mainnet endpoint, account ID or comment. Not `api.blocky402.com`,
  which is the mainnet facilitator.
- **Surface every transaction ID** and thread it through to the UI. Settlement state is
  read from a mirror node, never inferred from having sent something.
- **Hashes only on-chain.** Task content, artifacts and the expert's written notes never
  go on-chain.

When you learn something the docs do not say, or say wrongly, add it to
`docs/research/` as a conclusion. Never add a documentation summary.
