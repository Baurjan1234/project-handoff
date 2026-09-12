# handoff_status reports CLAIMED, read off the orders topic with the treaty's resolveClaims

**Decision.** `handoff_status` reads claim messages off the orders topic in the same scan
that finds the order envelope, resolves the holder with `resolveClaims` from
`@handoff/schema`, and reports a `CLAIMED` state carrying `claimedBy`, `claimedAt` and
`signBy`. `claimReadable` becomes true and stays in the shape as a misconfiguration
signal. The design system's claimed line — "Claimed by account 0.0.x · under review ·
sign by 18:12 UTC" — ships as written, and the `CLAIM_NOT_READABLE` fallback is demoted
to the case where a reader genuinely cannot see claims. The reply names the claimant's
**account**, never "a certified reviewer".

**Why.** `apps/mcp/src/status.ts` said, in a comment and in three hardcoded
`claimReadable: false` returns, that "no on-wire claim message exists yet — not in
`@handoff/schema`, not as a topic convention". That stopped being true when the claim
envelope shipped. `packages/schema/src/claim.ts` defines `ClaimEnvelope`, `tryDecodeClaim`
and `resolveClaims`; `apps/web/src/orders/claim.ts` publishes claims to the orders topic
from the expert's own account and resolves them with the same function. The reader was the
only end that had not been updated, so a requester whose order had been claimed an hour
earlier still read "Posted · waiting for a certified reviewer".

The winner rule is not reimplemented here. `claim.ts` says it lives in the schema package
because it has two ends, the expert app and the requester's status tool, and a rule
implemented twice is a rule that disagrees with itself. This change is the second end
calling it.

One scan, not two: claims share the orders topic, so reading them separately would double
every mirror-node read the query makes. The two shapes cannot be confused by a parser —
the order envelope is a strict object with no `kind`, the claim is a strict object that
requires one.

**Consequences.**

- **`OrderStatus` gains a state.** `POSTED | CLAIMED | DELIVERED | UNKNOWN`. The addition
  is additive and `GET /orders/{id}` is unversioned, but any reader with its own list of
  states has to learn the new one. `apps/web/src/requests/status.ts` did not: its decoder
  degrades an unknown state to `UNKNOWN`, which would have shown a claimed order as "Not
  read". It and `MyRequestsScreen`'s badge are updated in the same change. **That is P3's
  lane, touched only to keep this change from regressing their screen.**
- **`claimReadable: true` changes what a screen may say.** While it was false, no surface
  was allowed to present "nobody has claimed this". Now `POSTED` means exactly that, and
  the screens may say so. If it ever reads false again, something is misconfigured — a
  topic id pointing where claims are not published — and the old wording applies.
- **A claim whose window ran out reads as `POSTED`, not as a new state.** Claim timeout
  reopens the order once; that is what the topics say. The one case this does not
  distinguish — a second window expired, so no reopen remains — belongs to the lifecycle,
  which is unwired, and a status read does not invent a state for it.
- **A delivered order now carries `claimedBy` beside `signedBy`.** The attestations topic
  has no submit key, so who signed and who held the claim are two separate facts. Both are
  reported and neither is adjudicated: nothing here refuses a verdict signed by an account
  that never held the claim. **The verifier must check payer-account == winning claimant
  before it releases money.** That check does not exist yet and this change does not add
  it; it only makes the mismatch visible to a reader.
- **This is not registry work and does not gate anything.** The cert tag on a claim is
  filtered against the order's tag by `resolveClaims`, which is the treaty's own rule for
  which claims count, not a credential check. Any account can still claim, the registry is
  still absent, and the honesty rule stands: never say "certified", never say "allowlist".
- **`docs/design-system.md` is updated in the same change.** Its note that the claimed
  line "needs an on-wire claim message, which the schema does not have yet" is retired.
- Nothing about hashing, escrow keys, or the money path changes. No new on-chain write.

**Supersedes.** Nothing by file. It retires the standing constraint in
`docs/design-system.md` that status "goes from Posted to Signed and must not invent the
middle state", which was a dependency note rather than a decision — the dependency landed.
