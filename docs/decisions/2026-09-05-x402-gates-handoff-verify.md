# x402 gates handoff_verify

> **Amended** by `2026-09-05-hosted-blocky402-not-the-scaffold-facilitator.md`, which
> verified the version 2 header names against the published `@x402/core` bundle. The
> `X-PAYMENT` named below is the version 1 name. The decision itself stands.

**Decision.** `handoff_verify` becomes an x402-gated service. The requester agent pays a
per-call fee over x402, settled on `hedera:testnet` through the hosted Blocky402
facilitator, before an order is posted. This is Tier 1 and it is the single
prize-qualifying requirement.

**Why.** The Hedera prize page was read on 2026-09-05. The AI and Agentic Payments track,
$6,000 across up to three teams, requires a live x402-gated service on Hedera settled
through the Blocky402 facilitator, plus a platform or agent consuming it and completing at
least one real paid request end to end. Hedera Agent Kit appears only under links and
resources, never under qualification requirements. v1 had this backwards and would have
shipped a coherent product that did not qualify.

The fit is good rather than forced. One of the track's own suggested ideas is an agent
marketplace where services register and agents discover and pay, which is what Handoff
already is. Two extra-points items are already ours: verifiable payment audit trails on
HCS, and recurring payments using Scheduled Transactions.

**The shape.** Two money flows that must never be conflated.

| Flow | What | Rail |
|---|---|---|
| Service fee | Paying to call `handoff_verify` and post an order | x402 on `hedera:testnet` |
| Order value | The price of the human judgment | Escrow plus scheduled transfer |

Client gets HTTP 402, builds a Hedera `TransferTransaction`, partially signs with its own
ECDSA key, retries with the base64 payload in the `X-PAYMENT` header. The server calls the
facilitator's `/verify` and serves on success. The facilitator co-signs as designated fee
payer and `/settle` submits it. Settlement is asynchronous and returns a Hedera receipt.

**Facilitator.** `https://api.testnet.blocky402.com`, network identifier
`hedera:testnet`. Blocky402 mainnet is not available yet and hard rule 5 means we would
not use it if it were.

**Consequences.**

- **Pay in HBAR, not USDC.** HBAR is native and needs no token association. USDC on
  Hedera testnet requires association on both payer and receiver first.
- **The x402 signer must be an ECDSA account.** Check the key type on the portal rather
  than assuming the default.
- **The x402 receiver is a separate account from the escrow.** Never reuse the escrow
  threshold key.
- **Protocol fee is no longer zero.** v1 argued a fee into an idle account looks like
  skimming. The x402 call charge is the price of a real gated service, so that argument
  no longer applies and the honesty line changes.
- **P2 is now the heaviest lane.** Tseegii owns both sides of the gate, the resource
  server and the x402 client, on top of the MCP tool and the requester agent. Watch this
  seat, and prefer moving other work off it rather than thinning the gate.
- **Agent Kit is optional.** It stays on the build path because it pairs naturally, but
  if it competes with the gate for P2's time, the gate wins.

**Still open.** The per-call fee amount, and whether the gate sits in front of order
posting only or also in front of other reads.
