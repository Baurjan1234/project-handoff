# ScheduleCreate rejects a transfer that debits a KeyList account — blocker, not a confirmation

Run against real Hedera testnet on 2026-09-07, using a funded account
(`0.0.10119624`). This was meant to close NAS-5 ("Confirm schedule-at-claim on
testnet"). It did not confirm schedule-at-claim — it found a problem that the escrow
design assumes away.

## The finding

**`ScheduleCreateTransaction` fails immediately, at creation, with `INVALID_SIGNATURE`,
whenever the wrapped transaction debits a `KeyList` (multi-sig / threshold) controlled
account — regardless of key type, regardless of whether the payer's key overlaps the
KeyList, regardless of whether a KeyList member co-signs the creation.**

The identical debit, submitted as a plain (non-scheduled) `TransferTransaction`
properly co-signed 2-of-3, **succeeds**. So this is not a KeyList problem, not a
signing problem, not a key-type problem — it is specific to wrapping that debit in
`ScheduleCreateTransaction`.

## What was tested (five real testnet runs, in order)

| # | Script | Setup | Result |
|---|---|---|---|
| 1 | `confirm-schedule-at-claim.ts` | Escrow KeyList = [operator, verifier, admin], 2-of-3. Scheduled transfer debits escrow. | **FAILED**, `INVALID_SIGNATURE`, at `ScheduleCreateTransaction`'s own receipt |
| 2 | `diagnose-schedule-signature.ts` | Plain single-key operator, scheduled self-transfer, no KeyList anywhere | **SUCCEEDED** — rules out "scheduling is broken in general" |
| 3 | `diagnose-schedule-signature-2.ts` | Escrow KeyList of 3 fresh keys, **none** overlapping the operator | **FAILED**, same error — rules out "operator self-reference" |
| 4 | `diagnose-schedule-signature-3.ts` | Same as #3, but the `ScheduleCreateTransaction` itself is explicitly co-signed with one KeyList member before submit | **FAILED**, same error — rules out "just needs an explicit co-signer at creation" |
| 5 | `diagnose-schedule-signature-4.ts` | Same as #3, but ED25519 keys instead of ECDSA | **FAILED**, same error — rules out "ECDSA-in-KeyList quirk" |
| 6 | `diagnose-schedule-signature-5.ts` (control) | The **same debit**, same KeyList, same keys — submitted as a plain co-signed `TransferTransaction`, no schedule at all | **SUCCEEDED** — confirms the KeyList and the signing are both fine on their own |

Six runs, one variable isolated at a time. The only thing that reliably flips the
result is "is this transaction scheduled or not."

## What this means for the escrow design

The whole Tier-1 architecture (`docs/decisions`, `packages/chain/CLAUDE.md`,
`packages/schema/CLAUDE.md`) assumes: escrow account is a 2-of-3 `KeyList`; early-execute
happens by accumulating `ScheduleSignTransaction` calls from the verifier and
schedule-admin over time, against a schedule created once the payee is known. **That
sequence never gets past step one** if `ScheduleCreateTransaction` can't hold a
transaction debiting a KeyList account at all.

This is not yet a root cause, only a clean isolation. Two live possibilities, not
distinguished by testing done so far:

1. Hedera's Schedule Service does not support scheduling a transaction whose required
   signer is a `KeyList`/threshold key at all — only single Ed25519/ECDSA keys. If
   true, the 2-of-3 escrow account cannot be the account a scheduled payout debits,
   and the escrow design needs to change (candidates: a single-key escrow with a
   different early-execute mechanism; a smart-contract-mediated release; scheduling a
   transfer FROM a single-key intermediate account instead of the KeyList escrow
   directly).
2. There's a construction detail this repo's `ScheduleCreateTransaction` usage is
   missing that a KeyList-debiting schedule needs (something beyond what six
   variations here tried). Not found by elimination so far.

**Do not build further on the schedule-at-claim assumption until this is resolved.**
NAS-14 (`HederaChainAdapter`) implements the design as specified and is internally
correct against that design, but the design itself may not be buildable as written.

## Next step

This needs Hedera's own documentation or support channel, not more guessing by trial
and error — `hedera-docs` (the checked-in MCP server) is the tool for this, from a
session actually rooted in this repo. Search for `ScheduleCreateTransaction` +
`KeyList` / threshold key limitations specifically, not just general Schedule Service
docs (those were already read for `hedera-primitives-verified.md` and didn't surface
this).

## Cleanup note

Every escrow account created during this investigation (`0.0.10403433`,
`0.0.10403443` — a schedule, not an account, `0.0.10403470`, `0.0.10403499`,
`0.0.10403511`, `0.0.10403532`) is a disposable testnet artifact, left as-is. None of
them hold anything worth reclaiming.
