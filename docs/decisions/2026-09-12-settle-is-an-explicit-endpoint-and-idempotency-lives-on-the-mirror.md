# Settle is an explicit endpoint, not a watcher, and never-double-pay lives on the mirror node

**Decision.** The escrow release ships as `POST /orders/{id}/settle` on the resource
server: an explicit, ungated, idempotent call that a caller makes, never a background
loop the server runs. It takes an order id and nothing else — who claimed, what they
signed and what the order is priced at all come back off the public topics. The
never-double-pay guarantee moves out of process memory and onto the mirror node: every
payout carries the memo `handoff-payout:<order_id>`, and `signSchedule` asks the mirror
node whether that memo already appears among the escrow's debits **before** it composes
a signature. The expert app's sign action is where the call belongs on the product path
(P3); `pnpm --filter @handoff/mcp settle <order_id>` is what calls it until then.

**Why.** `SETTLED` was the one lifecycle beat with no code path. `packages/chain` could
pay — `executeDirectPayout` was proven on testnet on Sep 8 — but nothing validated an
attestation and asked it to. `executeDirectPayout` and `signSchedule` appeared only in
`packages/chain/scripts/live-happy-path.ts` and in `apps/web`'s mock platform; no real
order could reach `SETTLED`.

A watcher was the obvious shape and it is unsafe here. `PendingPayoutStore` is in-memory
and per-process, stated as a known limitation in its own module doc. A loop that
re-scanned the attestations topic on startup would meet every already-paid order with an
empty store, `createSchedule` would report `alreadyExisted: false`, and the payout would
fire a second time. "Payout is an idempotent retry. Never double-pay" is a vocabulary
rule in `CLAUDE.md`, so a design that holds it only until the first crash does not hold
it.

Making the *network* the memory fixes that, and it also settles the shape question: once
a retry is safe, a caller can retry, which is a reason to let them rather than to poll on
their behalf. It is also what the engineering agreements already require — "settlement
state is read from a mirror node, never inferred from 'we sent it'" — and a payout with
no memo cannot be read back at all, only inferred.

The mirror query shape was taken from the published OpenAPI for
`GET /api/v1/transactions` (docs.hedera.com, `api-reference/transactions/list-transactions`),
not from memory: `account.id`, `transactiontype=CRYPTOTRANSFER`, `result=success`,
`type=debit`, `order`, `limit`. `type=debit` is what keeps the read cheap — the shared
escrow is credited by every fund lock and debited only by a payout, so filtering to
debits turns "everything this escrow has ever seen" into "every payout it has made".

Three validations decide whether the money moves, and each is there for a rule:

- **Only the claimant's own attestation pays.** The attestations topic carries no submit
  key, so anybody can publish anything about any order. The Sep 12 `handoff_status`
  decision named this exact gap — "the verifier must check payer-account == winning
  claimant before it releases money. That check does not exist yet" — and this is that
  check. A stray attestation is treated as *noise*, not a violation: it does not pay, and
  it does not shadow the holder's real one either, or anyone could freeze any expert's
  payment for the price of one HCS message.
- **The verdict is never read.** There is deliberately no branch on `verdict` anywhere in
  the settle path. A reject is a delivered product and gets paid (hard rule 3).
- **A violation is mechanical or it is not one.** A class mismatch, an `artifact_hash_in`
  that is not the artifact the order named, a `cert_tag` that is not the one it routed
  to. A disagreement about the work is never one (hard rule 4).

**Consequences.**

- **Two windows the mirror read does not close, both named rather than implied.**
  Within one process, two overlapping settles would both read "not paid" — the mirror
  cannot see a transfer nobody has submitted yet — so `signSchedule` coalesces concurrent
  calls for the same payout onto one promise. Across processes there is a residual
  window: a restart inside the mirror node's ~6-second indexing lag, followed immediately
  by a retry, can still pay twice. Narrow, admitted, and the production answer is the
  durable payout store `pending-payout.ts` already says it needs.
- **The route is ungated and that is not a hole in the gate.** The x402 gate covers order
  posting only (`2026-09-05-gate-covers-order-posting-only.md`). Settling sells nothing:
  it moves money the requester already locked, to the expert who already signed, on facts
  that are already public, and a caller cannot make it pay anything other than what the
  topics say.
- **It refuses with 409, and `retryable` is the half a caller acts on.** The mirror node
  lags about six seconds behind consensus, so an expert settling the instant they publish
  will legitimately see a not-ready; a violation never becomes payable and a poller must
  stop. A chain failure is a 502 with the detail intact, because that message may carry
  the transaction id of a payout whose outcome is unknown.
- **`ReadableOrderState` does not gain `SETTLED` this week.** `apps/mcp/src/mcp/client.ts`
  parses the status body with `OrderStatusShape`, whose `state` is a strict `z.enum`, and
  the published `@hedera-handoff/mcp-client@0.1.1` would throw on a state it does not
  know. `SETTLED` is returned by the settle endpoint only. Adding it to status means
  republishing the client, which is a separate call.
- **`MockChainAdapter` diverges from the real adapter on a retried payout.** The mock
  mints a fresh transaction id when reporting an already-executed schedule; the real
  adapter returns the original payout's id. Neither pays twice, so this is fidelity and
  not safety, but a caller comparing ids across retries gets different answers on mock
  and on testnet. **P4's file, flagged rather than changed.**
- **`apps/mcp` gains one configuration value**, `escrowAccountId`, read from
  `HANDOFF_ESCROW_ACCOUNT_ID` on testnet and from `MOCK_ESCROW_ACCOUNT_ID` otherwise —
  the same place the adapter is given it. Two sources for one escrow id is how a settle
  ends up debiting an account the fund lock never credited.
- **The attestation-against-envelope cross-check lives in `apps/mcp/src/settle.ts` with a
  TODO naming `@handoff/schema` as its home.** It belongs beside the schemas it compares
  so the expert app refuses to *build* what the verifier refuses to *pay*. **P4's lane.**
- **Nothing calls this on the product path yet.** The expert app's sign action should
  `POST` it after publishing and render the payout transaction — **P3's lane, not done
  here.** Until it does, the demo settles through the script.
- **Verified end to end on real testnet, 2026-09-12.** One order through the running
  resource server: x402 fee settled through Blocky402, escrow funded by the requester's
  own signature, claim and a **reject** attestation published from the expert's own
  account, settle paid `0.0.10376667@1789200311.136173331` — and a second settle returned
  that same id. The mirror node shows exactly one debit carrying
  `handoff-payout:<order_id>`. `live-happy-path.ts`'s restart case also passed: a second
  adapter over the same escrow returned the original payout rather than making a new one.
  That run is what validated `type=debit`, `memo_base64` and the transfer legs against
  the real API rather than a stub.
- **The violation path was exercised for real too**, by accident and worth keeping: an
  attestation pinning a hash the order never named was refused with `409` and
  `retryable: false`, and no money moved.
- **`findPayout` cannot name the payee when the payee also paid the transaction fee.**
  Observed in that run: the expert's credit leg nets the fee out, so it no longer equals
  the escrow's debit and `payeeAccountId` comes back null. Informational only — the memo
  is what binds a payout to its order, and the settle reply takes the payee from the
  winning claim. In production the fee payer is the platform, not the expert.
- **The recording rule still applies.** This path has not run on testnet yet. It does not
  go on camera until it has run clean once; `live-happy-path.ts` remains the proven
  fallback.
- `docs/architecture.md` is updated in the same change.

**Supersedes.** Nothing by file. It closes the standing consequence left open by
`2026-09-12-handoff-status-reports-claimed.md` — the payer-account-equals-claimant check
before money moves — and it retires the "No schedule at post time … the schedule is
created at claim time" note in `apps/mcp/src/order.ts`, which described a claim-time hook
the server never had: the claim is an HCS message from the expert's own account, which
the server sees only through a mirror read, so the payout record is created at settle.
