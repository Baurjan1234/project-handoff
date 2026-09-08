# One shared escrow account this week, per-order escrow is roadmap

**Decision.** The escrow is one Hedera testnet account, provisioned once out of band with
the 2-of-3 KeyList, and every order locks funds into it. `lockFunds` stays a plain
transfer into that account, which is what `HederaChainAdapter` already does. A fresh
escrow account per order, with the requester's real public key in the KeyList, is
production roadmap and is named as such in the brief's Known limits. Nobody builds it
this week without Nasaa's say-so.

**Why.** Khishgee flagged the choice on NAS-14 rather than deciding it unilaterally, and
it is a product call, not a Hedera question. The two shapes compared:

- Shared escrow costs nothing new. Fund lock is a transfer into an existing account, there
  is no account-creation wait before an order posts, and there is one fewer thing to
  fail on camera. The costs are commingled funds with per-order accounting off-chain, a
  requester slot in the KeyList that is one shared session key rather than each
  requester's own, and a Hashscan view that shows one busy account instead of one order.
- Per-order escrow isolates each order's funds, puts the requester's own key genuinely
  in the threshold so clawback and refund mean what the brief says, and is the shape a
  future jury acts on. It costs an account creation plus a mirror-node lookup of the
  requester's key and key type per order, a few seconds of latency, account cleanup
  after settlement, and more paths to test.

Per-order is better in the long run and it is not close. Shared wins this week for one
reason: the demo has a single requester agent, so the shared requester key costs nothing
visible, and cutover night should not spend hours on account creation while the
ScheduleCreate signature fix from NAS-5 is still unverified. The brief already admits the
platform is trusted this week; a shared escrow does not widen that admission, it is the
same admission stated for the account rather than the keys.

**Consequences.**

- `HederaChainAdapter`'s current assumption is now the decision. The open question in its
  file doc closes and NAS-14 gets the comment.
- The brief's Known limits gains a bullet saying the escrow is one shared account and
  per-order isolation is roadmap. `docs/architecture.md`'s escrow quorum section says the
  same in one line. Both are P4's paths and are updated with this decision.
- The requester key in the KeyList is the demo requester's session key. Say that out
  loud if a judge asks who holds the third key.
- If NAS-5 passes tonight and Khishgee has slack on Tuesday Sep 8, per-order escrow is a
  contained change inside `lockFunds` and Nasaa may reopen this. Until then it is settled.
- Nasaa raises shared versus per-order escrow with the mentors at the feedback session,
  tracked on the Linear board, so the roadmap claim gets an outside opinion before the
  video is recorded.
