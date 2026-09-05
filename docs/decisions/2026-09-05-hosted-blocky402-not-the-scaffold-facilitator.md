# The hosted Blocky402 testnet facilitator, not the scaffold's

**Decision.** The x402 gate settles through the hosted facilitator at
`https://api.testnet.blocky402.com`, network `hedera:testnet`. We do not run the
`hedera-dev/scaffold-hbar` facilitator, and we do not self-host Blocky402. The template
stays a source of plumbing — the resource-server and client wiring — not of
infrastructure. We build on `@x402/core` and `@x402/hedera` version 2, which is the
protocol both facilitators speak.

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

**Consequences.**

- One fewer service to run, and nothing of ours to keep up during judging. The
  facilitator's uptime is now a demo dependency we do not control, which is the trade we
  are making knowingly.
- **`extra.feePayer` is discovered at startup from `/supported`, never hard-coded.** If
  Blocky402 rotates that account, a hard-coded value fails verification silently.
- **Version 2 header names, verified in the published `@x402/core` bundle.** The client
  pays with `PAYMENT-SIGNATURE`, the 402 challenge rides in a `PAYMENT-REQUIRED` header
  with the body as version 1 fallback, and the settlement receipt comes back as
  `PAYMENT-RESPONSE`. `X-PAYMENT` is the version 1 name. Nothing in the design changes —
  we go through `@x402/core` and never hand-roll a header — but the brief and root
  `CLAUDE.md` describe step 3 with the version 1 name and should be corrected, so nobody
  debugs a header that was never wrong. The two `apps/` lane files are fixed in this
  branch.
- `@x402/hedera` depends on `@hiero-ledger/sdk`, so the fee leg carries the Hedera SDK
  transitively without us importing it. Whether that satisfies "only `packages/chain`
  imports the Hedera SDK", or needs a written exception, is a rule-boundary question for
  the sync. It is not settled here.
- Mainnet Blocky402 requires an API key and is not released. Hard rule 5 costs us
  nothing.

**Supersedes.** Nothing. It closes the open question in
`../research/x402-reference-implementations.md`, which stays accurate as written. The
other question left open by `2026-09-05-x402-gates-handoff-verify.md`, whether the gate
covers reads, is settled separately in `2026-09-05-gate-covers-order-posting-only.md`.
