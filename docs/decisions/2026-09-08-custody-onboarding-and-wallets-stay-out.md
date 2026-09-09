# Custody, email onboarding and non-Hedera wallets stay out; three of them are already ruled, one needs Nasaa

**Decision.** Four questions came up from P1 on Sep 8 about things the product
arguably needs and this build does not have. Three are already answered by rules
in `CLAUDE.md` and answering them again here is just so nobody re-litigates them at
3am. The fourth is a genuine product call and it is **Nasaa's**, not P1's, and it is
left open below rather than decided by whoever asked last.

Nothing in this file changes any code. No Tier 1 work stopped to write it.

## Already ruled, not reopened

**1. Platform-created custodial Hedera accounts, holding HBAR on behalf of users, are
Tier 3.** `CLAUDE.md`'s ladder names "custodial web2 wrap" under *never build this
week*, and the brief is explicit about why: *"custodial accounts, fiat off-ramps,
nobody excluded for not understanding wallets. None of it is built this week beyond
the expert web app itself; custodial key management is a weeks-scale project."*

There is a second reason, stronger than scope, and it applies specifically to the
**expert** side: **if the platform holds the expert's key, the product's central
claim stops being true.** The whole argument is that the expert's own account
signature *is* the attestation — "a certified human stood behind this, attributably,
forever." An attestation signed by a platform-held key does not prove a human
reviewed anything; it proves the platform pressed a button. P3's connect screen
(pasted key, `SecretKey`, closure-held, never in React state) and
`createExpertChain`'s closure exist precisely so that never happens. Custody of a
*requester's* key is less corrosive — they are paying, not attesting — but is still
Tier 3 and still weeks of key management done properly.

**2. Email/password registration with a one-time email code is not in any tier,
because there is no user model to attach it to.** Identity in this design *is* the
Hedera account, and "registration" is an allowlist row with a cert tag (NAS-27),
which is the miniature version of the same idea and is already Tier 1. Email OTP
means mail transport, a token store, rate limiting and sessions, and then a mapping
from email to Hedera account — which drags custody back in through the side door.

**3. MetaMask and other chains are out, and MetaMask specifically cannot do this
job.** Publishing an attestation is a native HAPI `TopicMessageSubmitTransaction`.
MetaMask signs EVM transactions; it cannot sign a HAPI transaction, so this is not a
scope preference but a capability mismatch. Hedera's EVM layer exists, but nothing in
this design is a smart contract. The roadmap answer for wallet UX is a **Hedera-native
wallet** (HashPack, Blade, via Hedera WalletConnect), never MetaMask. Other chains are
out under hard rule 5. Checked: no `metamask`, `walletconnect`, `hashpack` or
`window.ethereum` anywhere in the repo, so nothing has quietly started.

## Findings that close two other questions, no ruling needed

**Deployment: nothing needs deploying, and no REST API needs building.** `apps/mcp`
already *is* the HTTP API — `GET /health`, `GET /tags`, and the x402-gated
`POST /orders`, with `pnpm start` to run it and a separate MCP stdio surface under
`pnpm mcp`.

The load-bearing detail, verified in `apps/mcp/src/x402/facilitator.ts`: **our server
calls out to Blocky402; Blocky402 never calls us.** `/supported`, `/verify` and
`/settle` are all outbound. And `serviceUrl` defaults to `http://localhost:${port}`
because the 402 challenge only needs to *name* what it charges for — the payer echoes
it back, nobody dials it. So the whole paid path, including settlement, works on
localhost with no public URL and no deployment.

Two exceptions worth knowing rather than discovering on camera: the expert app on a
second device needs a LAN address or a static host (it is a pure Vite build with no
backend), and if anyone outside the machine must hit the API, a tunnel beats a deploy.

**x402 credentials: there are none to obtain.** Testnet Blocky402 needs no
authentication and no API key (`docs/research/x402-blocky402-wire-verified.md`;
mainnet wants an `X-Api-Key` and is forbidden anyway). Everything is self-served:
`X402_PAYER_ACCOUNT_ID`/`_PRIVATE_KEY` is a portal account that **must be ECDSA**
(`X402Signer` throws otherwise), `X402_RECEIVER_ACCOUNT_ID` is a second account with
no key needed because receiving requires no signature, and `X402_FEE_TINYBARS` was
committed on Sep 6 as `50000000`.

## Still open — Nasaa's call, deliberately not made here

**Does the custodial onboarding story become a roadmap slide, or does it stay
unsaid?** The concern behind the question is real and worth answering out loud: a demo
where both sides already hold funded Hedera accounts is not a product anyone can buy,
and a judge may well ask who onboards the expert. The brief already has the "Web2
wrap" roadmap line for exactly this, but nobody has decided how much weight it
carries in the video and the pitch.

Nasaa owns this because it is scope and story, not engineering:

- how prominent the onboarding roadmap is in the 90 seconds and in the close,
- whether the honest "both accounts pre-exist, custody is roadmap" admission is said
  on camera or only if asked,
- whether it is worth raising at a feedback session to get an outside read before the
  recording.

P1's position, for the record: the thing that makes this sellable **this week** is that
a machine pays a human and the money moves on a public ledger through a real paid
request. Onboarding is what makes it sellable next quarter. Three days before freeze,
the leverage is in the demo and the framing, not in shipping half a custody system.

## Consequences

- Nothing gets built for any of the above this week. If someone finds custody, an
  email flow, or a wallet integration on a branch, it is out of tier and should be
  cut, not finished.
- Nasaa rules on the roadmap-slide question, and it goes in the pitch or it does not.
  Whichever way, this file gets the answer appended rather than a new file.
- `X402_FEE_TINYBARS=50000000` is not a decision anyone needs to make again; it is
  already committed. The two x402 account ids still need someone to create them at
  the portal, and `apps/mcp` does not boot without the receiver id and the fee.

## Supersedes

Nothing. This restates and cites `CLAUDE.md`'s Tier 3 ladder, hard rule 5, the
Sep 6 price decision and the Blocky402 research rather than overturning any of them.
