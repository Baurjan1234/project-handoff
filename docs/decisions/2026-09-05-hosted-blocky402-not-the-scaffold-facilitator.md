# The hosted Blocky402 testnet facilitator, not the scaffold's

**Decision.** The x402 gate settles through the hosted facilitator at
`https://api.testnet.blocky402.com`, network `hedera:testnet`. We do not run the
`hedera-dev/scaffold-hbar` facilitator, and we do not self-host Blocky402. The template
stays a source of plumbing — the resource-server and client wiring — not of
infrastructure. We build on `@x402/core` and `@x402/hedera` version 2, which is the
protocol both facilitators speak.

The x402 gate covers **order posting only** this week. Reads are not gated. That closes
the last of the brief's open x402 questions.

**Why.** NAS-17 asked whether the template's facilitator is Blocky402 under another
name. It is not: `facilitator/package.json` on `templates/x402-pay-per-use` names itself
`x402-hedera-facilitator` and describes itself as a self-hosted facilitator wrapping the
official `@x402/hedera` reference scheme. Two different programs speaking one protocol.

The prize requires settlement through the Blocky402 facilitator, and the hosted testnet
endpoint is the only reading that satisfies that without argument. It is live:
`GET /supported` on 2026-09-05 returned `hedera:testnet` with `x402Version: 2`, scheme
`exact`, and `extra.feePayer` `0.0.7162784`; `/health` returned ok. Testnet needs no
authentication. Measurements and wire shapes are in
`../research/x402-blocky402-wire-verified.md`.

Gating posting only is the smaller build and it is what the qualification requires — a
paid call that posts an order. Gating reads would add a second paid path with no prize
value, and the mirror node is public anyway, so a gate in front of reads would be
theatre.

**Consequences.**

- One fewer service to run, and nothing of ours to keep up during judging. The
  facilitator's uptime is now a demo dependency we do not control, which is the trade we
  are making knowingly.
- **`extra.feePayer` is discovered at startup from `/supported`, never hard-coded.** If
  Blocky402 rotates that account, a hard-coded value fails verification silently.
- The header on the version 2 path is `PAYMENT-SIGNATURE`, not `X-PAYMENT`. The brief,
  `CLAUDE.md`, `apps/mcp/CLAUDE.md` and `apps/requester/CLAUDE.md` all name `X-PAYMENT`,
  which is the version 1 name. Those four documents are now inaccurate on that one line.
  Nothing in the design changes — we go through `@x402/core` and accept both names on our
  own server — but the wording should be fixed so nobody debugs a header that was never
  wrong.
- `@x402/hedera` depends on `@hiero-ledger/sdk`, so the fee leg carries the Hedera SDK
  transitively without us importing it. Whether that satisfies "only `packages/chain`
  imports the Hedera SDK", or needs a written exception, is a rule-boundary question for
  the sync. It is not settled here.
- Mainnet Blocky402 requires an API key and is not released. Hard rule 5 costs us
  nothing.

**Supersedes.** Nothing. It closes the open question in
`../research/x402-reference-implementations.md` and the "gate posting or reads" item in
`2026-09-05-x402-gates-handoff-verify.md`, both of which stay accurate as written.
