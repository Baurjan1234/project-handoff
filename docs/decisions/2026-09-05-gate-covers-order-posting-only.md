# The x402 gate covers order posting only

**Decision.** The x402 payment gate sits in front of posting an order through
`handoff_verify` and nothing else. Reads are not gated: order state, attestations and
settlement all stay free to fetch. One paid path this week.

**Why.** The prize qualifies on an agent completing a real paid request end to end, and
posting an order is that request. A second paid path adds build time, a second fee
number to commit and narrate, and a second thing to go wrong on camera, for no
qualification value.

Gating reads would also be close to theatre. Orders and attestations are on public HCS
topics and any mirror node serves them without asking us, so a paywall in front of our
own read endpoint protects nothing that is not already public. Charging for it would
have to be argued as convenience pricing, which is not a story worth telling to a judge
in a five-minute video.

Closes the last item left open by `2026-09-05-x402-gates-handoff-verify.md`.

**Consequences.**

- One fee number to ratify rather than two. NAS-8 gets simpler: the demo order price and
  a single per-call service fee.
- The brief's "Still open" list and root `CLAUDE.md`'s "Open decisions" both carry this
  question as unanswered and are now stale on that line. Both are P4's paths.
- Read paths in `apps/mcp` stay unauthenticated, so nothing there may return anything the
  HCS topics do not already make public. Content-store reads are a different mechanism —
  signed URLs, access control, not payment — and this decision does not touch them.
- If a judge asks why reads are free, the answer is the second paragraph above, not
  "we ran out of time".
