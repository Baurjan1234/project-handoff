# packages/chain — the only Hedera SDK importer

**Owner: P1 Khishgee.** Everyone queues behind this lane.

## What this package owns

- The escrow account and its 2-of-3 threshold key.
- `ScheduleCreate`, `ScheduleSign`, `ScheduleDelete`, and the early-execute path.
- HCS topics: creation, message submission, and the submit-key decision per topic.
- Mirror-node reads for settlement state.
- The real `ChainAdapter`, implementing the same interface as `MockChainAdapter`.

## What this package must never do

- **Never define the shapes.** Types, schemas, bounds and the adapter interface live in
  `@handoff/schema`. This package implements against them.
- **Never convert money.** Import from the money module.
- **Never swallow a transaction ID.** Every call returns one and it gets threaded
  through to the UI. Settlement state is read from a mirror node, never inferred from
  "we sent it."
- **Never touch mainnet.** Not an endpoint, not an account ID, not in a comment.
- Never let a platform key reach a browser build. This package is server-side only.

## Settled facts, verified, do not re-derive

- **`ScheduleCreate` needs a fully formed inner transaction**, so the payee must be
  known. Schedule at claim, not at post. See
  `../../docs/research/hedera-primitives-verified.md`.
- **`adminKey` is required**, or the schedule is immutable and both the claim-timeout
  path and the violation clawback become impossible.
- **`waitForExpiry` defaults to false**, which already is early-execute. Do not build a
  second mechanism.
- **`IDENTICAL_SCHEDULE_ALREADY_CREATED` returns the existing schedule ID.** That is the
  idempotency primitive behind never double-paying.
- **Topic submit keys differ by topic.** Orders and attestations have none, because
  experts submit from their own accounts. The registry has one.

## The cutover

Mon Sep 7 night. P2 and P3 run against this adapter before check-in 1. Drive it.
