# Direct co-signed payout replaces ScheduleCreate for the KeyList escrow

**Decision.** `HederaChainAdapter`'s `createSchedule`/`signSchedule`/`deleteSchedule`
no longer use Hedera's native Schedule Service (`ScheduleCreateTransaction`,
`ScheduleSignTransaction`, `ScheduleDeleteTransaction`). Instead: `createSchedule`
records the pending payout's parameters locally (`pending-payout.ts`); `signSchedule`
builds a single `TransferTransaction` debiting the escrow account and co-signs it
with both the verifier key and the schedule-admin key in one call
(`direct-payout.ts`), submitting it directly. The external `ChainAdapter` contract
(`packages/schema/src/adapter.ts`) is unchanged — every method still returns the
same shapes, `alreadyExisted` and `executed` still mean the same things. Only the
internals moved.

**Why.** `docs/research/schedule-create-keylist-blocker.md`: `ScheduleCreateTransaction`
fails with `INVALID_SIGNATURE` whenever the wrapped transaction debits a
`KeyList`-controlled account — verified across 8 isolated testnet runs (key type,
operator overlap, one co-signer, the full 2-of-3 threshold, frozen vs. unfrozen
inner transaction), plus a `hedera-docs` search that found nothing confirming or
denying this exact shape. Root cause unresolved; a Hedera team answer is pending
(NAS-5), but Check-in #1 is due today and the demo needs a live, honest testnet path
now, not after Hedera's Discord responds.

The realization that makes this safe rather than a regression: the verifier and
schedule-admin keys already live in the same trusted backend process — this
project's own Known limits already say so ("the platform is trusted this week...
two Node processes on one team are not two custodians"). Hedera's Schedule Service
exists to let signers who act at *different times, from different processes*
accumulate signatures on a transaction gradually. We don't have that problem: both
signatures are available in the same call, in the same process, the instant
`signSchedule` is invoked. Routing that through a network primitive built for a
problem we don't have was the point of failure; signing both keys onto one
transaction directly sidesteps it without giving up anything we hadn't already
admitted.

**Consequences.**

- Verified against real testnet before landing, not just unit-tested: see the
  end-to-end run logged in this commit's script output
  (`packages/chain/scripts/live-happy-path.ts`).
- `IDENTICAL_SCHEDULE_ALREADY_CREATED`'s idempotency is now reproduced locally
  (`derivePendingPayoutId` — identical params hash to the identical id) rather than
  relying on the network to say so. Same guarantee, different mechanism.
- **New honest limitation, stated once here:** the pending-payout state is
  in-memory, per-process. A process restart between `createSchedule` and
  `signSchedule` loses an unexecuted payout's bookkeeping. Acceptable for a demo
  that runs inside one session; not acceptable for anything longer-lived without
  backing this with the content store or a small database first.
- `deleteSchedule` (CLAIM_TIMEOUT reopen, VIOLATION clawback) is a local-only
  cancellation now — there is no on-chain schedule to delete, so no new
  transaction is created by cancelling one. Not exercised by today's demo path
  (the happy path: `POSTED -> CLAIMED -> DELIVERED -> SETTLED`); revisit whether
  CLAIM_TIMEOUT/VIOLATION need their own on-chain audit trail before those paths
  are demoed for real.
- `schedule.ts` (the original `ScheduleCreateTransaction`-based implementation) is
  left in the codebase, unused by `HederaChainAdapter`, in case Hedera's answer to
  NAS-5 turns out to unblock it after all — this is a workaround for a confirmed
  blocker, not a claim that the original design was wrong.
- If Hedera's team says this is a bug that gets fixed, or names a construction we
  didn't try, this decision should be revisited — the direct-payout path is a
  pragmatic answer to today's deadline, not a permanent architectural stance.

**Supersedes.** Nothing directly, but narrows the scope of
`2026-09-08-p1-signs-off-on-hiero-sdk-2.85.0.md` and every earlier reference to
"schedule-at-claim" as executed via Hedera's Schedule Service — the lifecycle
semantics (schedule-at-claim, early-execute, claim-timeout) are unchanged; the
mechanism underneath one step of them is not.
