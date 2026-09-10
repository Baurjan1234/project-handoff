# Handoff

**Agents do the work. A certified human stands behind it.**

An on-chain protocol for buying human judgment. Funds lock up front, a credentialed human
signs an attestation, payment releases on the signature. Settled on Hedera.

**Testnet only, always.** There is no mainnet path in this code and there is not meant to
be one.

Built for ETHOnline 2026, Hedera AI & Agentic Payments.

## What existed before the hackathon

Eight planning documents, written on 2026-09-04, the day before kick-off. They iterate on
the idea, and include an earlier and broader scope covering physical errands which was cut
during that planning, before any code was written. **Nothing else predates the event: no
code, no designs, no assets.** The final planning document was adopted unchanged into this
repository as [`docs/project-brief-v1.md`](docs/project-brief-v1.md), and
[`docs/project-brief-v2.md`](docs/project-brief-v2.md) supersedes it with everything that
changed during the build. Every source file, test and configuration here was written during
the event, and the commit history is the record.

## The problem

Agent fleets now produce most of the work — reports, filings, translations, code. Nobody
accountable has looked at it. The last mile of trust is human, and there is no protocol for
ordering it, pricing it, or proving it happened.

Handoff is that protocol. A requester posts an order and locks the money. A certified
expert claims it, does the work, and publishes a signed attestation from their own Hedera
account. Payment releases on the signature, **whatever the verdict** — you bought judgment,
not approval, so a reject is a delivered product and gets paid.

## The two money flows

They are never conflated, in the code or on camera.

| Flow | What it is | Rail | Size |
|---|---|---|---|
| **Service fee** | Paying to call `handoff_verify` and post an order | x402 over HTTP, settled on `hedera:testnet` | Micropayment |
| **Order value** | The price of the human judgment | Escrow account plus a scheduled transfer | The demo price |

## The payment flow, step by step

The service fee is an [x402](https://github.com/x402-foundation/x402) payment settled
through the hosted **Blocky402** testnet facilitator at `https://api.testnet.blocky402.com`,
network `hedera:testnet`.

1. The client calls `POST /orders`.
2. The server answers **HTTP 402**, stating the price in a `PAYMENT-REQUIRED` header. The
   fee payer named in it is discovered from the facilitator's `/supported` at request time,
   never hard-coded.
3. The client builds a Hedera `TransferTransaction`, partially signs it with its own
   **ECDSA** key, and pays no gas.
4. The client retries with the base64 payload in the **`PAYMENT-SIGNATURE`** header.
   (`X-PAYMENT` is the x402 version 1 name; this build speaks version 2 and reads both.)
5. The server posts it to the facilitator's `/verify`. On success — and only then — the
   order envelope publishes to HCS and the funds lock in escrow.
6. The server calls `/settle`. The facilitator co-signs as the designated fee payer and
   submits it, returning a Hedera receipt whose transaction id comes back to the client in
   a `PAYMENT-RESPONSE` header.

**Verification gates serving, settlement happens last.** `/verify` proves a payment is good
without submitting it, so an order that fails to post leaves the caller's money untouched.

Payment is in **HBAR** (`asset: "0.0.0"`), not USDC: HBAR is native and needs no token
association on either account. The x402 receiver is a **separate account from the escrow**.

The wire shapes are documented, with the measurements behind them, in
[`docs/research/x402-blocky402-wire-verified.md`](docs/research/x402-blocky402-wire-verified.md).

## The order lifecycle

```
POSTED     order envelope on HCS (hashes only), funds locked in escrow
CLAIMED    first valid claim from a certified account wins; the consensus
           timestamp is the truth, and the claimant gets a claim timeout that
           is short relative to the order deadline
DELIVERED  the expert publishes a signed attestation on HCS from their own
           account; the service validates it and co-signs the scheduled payment
SETTLED    payment executed, confirmed by a mirror-node read
```

Three exits: **CLAIM_TIMEOUT** (idle claimant, the order reopens once with a fresh
schedule), **TIMEOUT** (unclaimed at the deadline, funds return), and **VIOLATION** (a
mechanical schema failure — the only clawback path).

**Hashes only on-chain.** The task specification, the artifact and the expert's written
notes live in the content store; only their hashes are published. The scheduled payment is
created at claim time, not at post time, because `ScheduleCreate` carries a fully formed
inner transfer and the payee is unknown until somebody claims.

## Architecture

One pnpm workspace. Libraries in `packages/`, deployables in `apps/`.

| Package | What it owns |
|---|---|
| `packages/schema` | The treaty: zod schemas, `schema_version`, the money module, canonical hashing, the `ChainAdapter` interface and `MockChainAdapter` |
| `packages/chain` | Escrow, scheduled payment and early execute, HCS, mirror reads. **The only package that imports the Hedera SDK** |
| `packages/content` | The content store behind an interface |
| `apps/mcp` | The `handoff_verify` MCP server and the x402-gated resource server in front of it |
| `apps/requester` | The demo requester agent |
| `apps/web` | The expert app: inbox, review workspace, sign |

Two constraints hold regardless of how anything else moves. `packages/schema` is the
cutover seam — the real Hedera adapter and `MockChainAdapter` satisfy the same interface, so
swapping them is one line in a composition root. And platform keys never enter a workspace
with a browser build.

Diagrams: [`docs/architecture.md`](docs/architecture.md). Settled questions:
[`docs/decisions/`](docs/decisions/).

## Setup

Node is pinned in `.nvmrc` and pnpm in `package.json`.

```bash
nvm use                 # Node 24.11.1
corepack enable pnpm    # pnpm 10.32.1
pnpm install            # also arms the pre-commit hook via core.hooksPath
```

Install [gitleaks](https://github.com/gitleaks/gitleaks). The pre-commit hook refuses to
run without it, and it refuses to let a real `.env` file be staged — no secrets in this
repository, ever.

```bash
cp .env.example .env    # fill in your own testnet accounts
```

Two more one-time steps for agent sessions:

1. Export your testnet account in your shell profile, not only in `.env`, because
   `.mcp.json` expands from the environment: `export HEDERA_ACCOUNT_ID=0.0.xxxxxx`
2. Run `/mcp` once to authenticate Linear.

Get testnet accounts from [portal.hedera.com](https://portal.hedera.com/). **The x402
signer must be an ECDSA account** — check the key type rather than assuming the portal
default.

## Running it

```bash
pnpm --filter @handoff/mcp start    # the x402-gated resource server, :4021
pnpm --filter @handoff/mcp mcp      # the handoff_verify MCP server, over stdio
pnpm --filter @handoff/mcp smoke    # prove the gate against the live facilitator
pnpm typecheck && pnpm test         # what CI runs, plus a gitleaks scan
```

`smoke` needs the resource server running and talks to the real Blocky402 testnet
facilitator. It is not a unit test on purpose: CI should not go red because somebody else's
service is down.

**Where this is, as of the last commit to this file.** The whole requester path runs on
testnet: an agent calls `handoff_verify`, the service fee settles through the live
facilitator, the order value locks in escrow and the envelope reaches the orders topic,
each with a transaction id you can read on a mirror node. The expert path claims, reviews
and signs. What is not wired is the payout: `createSchedule` tracks it in memory rather
than creating a Hedera schedule, so an attestation is published and paid by hand.

## Ordering from your own agent

**Nothing to clone.** The client is published, so any agent session on any machine can
order from the running service:

```bash
claude mcp add handoff \
  -e HANDOFF_SERVICE_URL=https://api.the-handoff.xyz \
  -e X402_PAYER_ACCOUNT_ID=0.0.xxxxxx \
  -e X402_PAYER_PRIVATE_KEY=your-ecdsa-key \
  -- npx -y @hedera-handoff/mcp-client
```

Then restart the session: tools appear at startup, never mid-session. `handoff_verify`
posts an order and `handoff_status` reads one back.

**Your account must be ECDSA**, and it needs the service fee plus the order value plus a
little gas. Get testnet accounts from [portal.hedera.com](https://portal.hedera.com/) and
check the key type rather than assuming the portal default — a preflight read tells you
before anything is signed, but it is the commonest way to lose an evening.

**Your key never leaves your machine.** This client is the half that signs, and it signs
twice: the x402 service fee, and the fund lock whose debited account and fee payer are
both you. Only the signatures go over the wire. The service validates the returned bytes
against what it asked for and submits them; it holds no key of yours. That is why this
runs beside you rather than on a server, and it is why "no clone" and "the key stays
local" are compatible at all —
`docs/decisions/2026-09-10-one-hosted-resource-server-and-a-published-client.md`.

### Running your own service instead

Only needed if you are working on the service itself. It requires the two platform keys
and the Supabase service key, which are vault-only.

```bash
pnpm --filter @handoff/mcp start        # the resource server, :4021
```

Then point the client at it with `HANDOFF_SERVICE_URL=http://localhost:4021`. Four values
in `.env` have to match everyone else's or you will be alone on your own chain:
`HANDOFF_ORDERS_TOPIC_ID`, `HANDOFF_ATTESTATIONS_TOPIC_ID`, `HANDOFF_ESCROW_ACCOUNT_ID`
and `X402_RECEIVER_ACCOUNT_ID`. Ask P1 rather than provisioning your own, and set
`HANDOFF_CHAIN=testnet` — it ships as `mock`.

Check stderr before ordering. `x402 payer: 0.0.…` means the key parsed and the curve is
right; `payment signer: none` or `x402 payer unavailable` names which is wrong.
`credentials: cpa-us` means the service answered, so you are pointed at something running.

## Known limits

These are said out loud before anyone asks, and no other document in this repository
overrides them.

- **Certification is an allowlist this week.** The issuers are not here and the scarcity is
  not here; the interface is. An attacker does not burn a scarce credential — it is a row
  we delete.
- **Disputes are stubbed.** A rubber-stamp attestation gets paid in this build. It is
  attributable forever on HCS, and m-of-n jury plus bonds is the production answer.
- **The platform is trusted this week.** The verifier key and the schedule-admin key are
  both ours, so payout liveness and schema adjudication are custodial. Two Node processes on
  one team are not two custodians.
- **The `execution` class is schema and architecture**, demoed as roadmap. Its acceptance
  proofs need a trusted fetcher, and we did not write one.
- **Content availability is centralized** behind one vendor. The on-chain hash is the
  commitment; the parties keep their own copies.
- **Hashscan is a viewer, not a dependency.** Attestations live on HCS and the apps read
  mirror nodes directly.
- Incentive symmetry — pay-on-any-verdict plus a broadcast fix market — is a production
  thesis. **Only the first half ships.**

## Repository conventions

Commit small and often; never force-push and never rewrite history. Lane branches, pull
requests into `main`, and one CI workflow: typecheck, unit tests, gitleaks. A settled
question becomes a dated file in `docs/decisions/` within the hour, because a decision that
is not written down gets re-litigated.

`AI-USAGE.md` records how AI tools were used, and `ai-usage/` carries a per-seat session
log. Neither is required by the rules; both are our own choice.
