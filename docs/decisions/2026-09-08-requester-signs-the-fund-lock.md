# The requester signs the fund lock; the platform stops funding the escrow

**Decision.** The escrow is funded by the requester's own account, not by the platform
operator. `lockFunds` is replaced on `ChainAdapter` by a two-step exchange:
`buildFundLock` freezes a transfer whose debited account **and fee payer** are both the
requester and hands back the unsigned bytes; the requester signs them on their own
machine with the key that already signs the x402 fee; `submitFundLock` validates the
returned bytes against what the server asked for and submits them. The server never
signs the requester's transfer and never holds the requester's key.

Approved by Nasaa on 2026-09-08, option (b) of the two put to her in
[PR #26](https://github.com/nasaa0528/project-handoff/pull/26). She holds scope-cut
authority, so this overrides the timing argument that ran against it.

**Why.** `lockFunds` debits whatever account the adapter's client signs as, which server
side is the platform operator. The first live paid run on testnet, 2026-09-08:

```
0.0.10376667  -10000125046   <- platform operator
0.0.10422187  +10000000000   <- escrow
```

The requester paid only the 0.5 HBAR x402 service fee, from their own account. Two
things follow. "Funds lock up front" reads to a judge as the requester's money at risk
and it is ours, and a public endpoint is drainable at roughly the operator balance
divided by the order price — 894 HBAR against a 100 HBAR order is eight requests.

This was never a decision anybody made. `docs/decisions/2026-09-07-one-shared-escrow-account-this-week.md`
deferred the requester's *key in the KeyList*, which is the clawback right; who *funds*
the escrow was not in scope there and landed by implementation accident. The product
copy already assumed the fixed shape: `docs/design-system.md` beat 2 tells the requester
they need "0.5 HBAR for the fee plus 100 HBAR for escrow".

Three properties of the shape, each chosen against an alternative:

- **The requester is the fee payer as well as the debited account**, so one signature
  covers both and the server has nothing to add. A platform fee payer would need a second
  signature and put the platform back in the transfer.
- **Stateless.** `submitFundLock` takes what the server asked for and re-validates the
  returned bytes, rather than the server holding the frozen transaction in memory and
  applying a signature to it. Same issue → echo → validate shape as x402 itself, no
  expiry sweep, no sticky sessions, and the validator is a pure function and therefore a
  unit-test target, which the money-path rule requires anyway.
- **Whitelist, not blacklist.** The bytes have crossed the wire. Amount, escrow account,
  debited account, fee payer and signed-by are each checked against the expected
  parameters and never against what the bytes claim.
- **The validity window is bounded, not matched.** `LockFundsParams` carries no window,
  so there is nothing in the expected parameters to compare it to — an earlier draft of
  this file claimed it was matched, and that check cannot exist. It is bounded instead:
  the instant has to fall inside the window the server would have issued had it built
  the lock now, which refuses a forged `validUntil` without needing state. Past that it
  is the signature that protects the field, and the network refuses a doctored one with
  `TRANSACTION_EXPIRED` at precheck.

Signature *validity* is deliberately not checked. The network checks it, a bad signature
fails at consensus with nothing moved and the x402 fee still unsettled — the same
verify-gates-serving, settle-last ordering the payment gate already relies on.

The frozen window is set to **180 seconds explicitly**, not Hedera's 120-second default.
Between the 402, the client's preflight mirror read and the facilitator's `/verify` the
default is a real expiry path, so `UnsignedFundLock` carries `validUntil` and the server
re-challenges instead of burning a round trip on `TRANSACTION_EXPIRED`.

**Consequences.**

- `packages/schema` (P4): `RequesterFundedEscrow` folds into `ChainAdapter` and
  `lockFunds` is deleted. Tagged `breaking`. The proposal and `MockChainAdapter`'s
  implementation are on `tsee9iii/requester-funded-escrow`.
- `packages/chain` (P1): the real `submitFundLock` validator. Needs SDK surface nobody
  has verified yet — reading `hbarTransfers`, `transactionId.accountId` and
  `transactionValidDuration` off a parsed transaction, and confirming `freezeWith`
  preserves a transaction id set beforehand. Never recall these from memory.
- `apps/mcp` (P2), four changes: the 402 handler reorders, because `gate()` runs before
  the body is parsed today and the 402 now needs `price_hbar` first — a malformed body
  starts returning 400 instead of 402. `OrderRequestBody` gains `requester_account_id`,
  because `HANDOFF_REQUESTER_ACCOUNT_ID` is a server env var and a public endpoint would
  stamp every order with one configured requester; the paid retry asserts the x402 payer
  equals the body's requester. Preflight's balance check includes the order value, not
  just the fee. The MCP client signs the returned bytes.
- **~~An open question the accepted shape has to close.~~ Closed: the id is minted on the
  first POST and echoed through the 402 extension.** `buildFundLock` takes
  `LockFundsParams`, which requires an `orderId` that does not exist at 402 time —
  `apps/mcp/src/order.ts` mints it on the paid call. Dropping it from the build params
  was the alternative, and it is not available: the escrow is **one shared account**
  (`2026-09-07-one-shared-escrow-account-this-week.md`), so the credited account binds a
  lock to nothing, and without the order id the whitelist reduces to (requester, price,
  that one escrow) — two orders at the same price from the same requester are then
  satisfied by the same bytes. The binding is the **transaction memo**, which carries
  `order_id` and sits inside the signed body, so it cannot be moved to another order
  without invalidating the signature. Hedera caps a memo at 100 bytes; an
  `ord_`-prefixed uuid is 36.
- **The "locked but not posted" window moves, it does not close.** If the envelope fails
  after the lock lands, the requester has funds in escrow and no order. `TIMEOUT` returns
  them at the deadline, so demo deadlines must be hours rather than days.
- `docs/project-brief-v2.md` Known limits keeps the platform-funded paragraph until this
  lands, and its last sentence changes from roadmap to shipped when it does. The
  **the service stays private until this lands.** It does not go out behind a price cap
  and an operator-balance floor instead: those guard the platform-funded escrow, which
  this decision deletes, so building them is work on a path with a week to live.
- **Escrowed funds have no return path, and this changes whose money is stuck.**
  `TIMEOUT` is a label in the lifecycle state machine; `ORDER_DEADLINE_EXPIRE` is fired
  by nothing outside its own unit test, no process watches deadlines, and
  `packages/chain/src/escrow.ts` has a transfer in and none out. An unclaimed order
  holds its funds indefinitely. That is our money today and the requester's afterwards.
  P1's lane, and a Known limits line rather than code if the freeze arrives first. A
  maximum deadline is **not** the fix and was wrongly named as one in the first draft of
  this file — bounding a deadline bounds nothing while nothing acts on it.
- `docs/architecture.md` fund-lock arrow becomes two arrows and gains the signature.

**Supersedes.** Nothing. It closes a gap
`2026-09-07-one-shared-escrow-account-this-week.md` left open rather than overturning it;
the one shared escrow account and the off-chain per-order accounting are unchanged.
