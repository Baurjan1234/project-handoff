# Handoff — Project Brief v1 (repo baseline, 2026-09-04)

> **Source of truth for ETHOnline 2026** (hacking Sep 5–12 UB, Hedera AI & Agentic
> Payments bounty).
>
> **Provenance.** Three pre-hackathon drafts iterated on the idea before any code
> existed. This document is the content of that final pre-hackathon draft, dated
> 2026-09-04 after round-2 audits (grok-v2, gemini-v2, gpt-oss), adopted unchanged as
> **repo v1**. The audit triage itself is not carried into the repo; every conclusion
> that survived it is already in Known limits. Version numbers restart here, so from now on a bump
> means a change made during the build week. It wins on *scope* over the earlier
> `handoff-project-plan.md` and `two-track-scope.md`.
>
> **What the round-2 audits changed** (kept for context): corrected ScheduleSign
> mechanics (expert key is HCS-only); claim-timeout split from schedule expiry; Insight 3
> demoted to production thesis; platform-custody admission; HCS size limits on the
> attestation; class-specific hashes; mock→testnet cutover rule; recording rule; Agent
> Kit on the build path; fee = 0 this week; allowlist wording honesty; registry events
> on HCS.

## One-liner

**Agents do the work. A certified human stands behind it.**

Handoff is an on-chain protocol for buying human judgment and human capability — funds
locked up front, a credentialed identity on the other end, and a signed, permanent
attestation as the deliverable. Settled on Hedera: sub-cent fees, 3-second finality.
Testnet only, always.

## The problem

Agent fleets now produce most of the work — reports, filings, translations, code, whole
apps. Nobody accountable has looked at it, and nobody accountable does the risky last
step. The last mile of trust is human, and there is no protocol for ordering it,
pricing it, or proving it happened.

Real demand, unprompted (Facebook ad, Sep 2026): *"I've designed and coded my app (web
and mobile). I need someone to integrate the APIs and deploy."* That ad is our **demand
evidence** — this week ships the `review` class; the ad's `execution` class is schema +
labeled roadmap (see Known limits).

## Core insight 1 — modality-agnostic endpoints

The protocol does not care whether either end is a human, a human steering an agent, or
an autonomous fleet. **Agents are optional at both ends. Accountability is not.** What
is non-negotiable is what goes on-chain: the order, the locked funds, the credentialed
identity, and the signed attestation.

| Requester side | Expert side | Example |
|---|---|---|
| Fleet, automatic (via MCP) | Person + their own fleet | Report built in a coding session (fabricated demo artifact); expert's agents pre-analyze; the human signs |
| Person steering an agent | Person, no agent at all | The "fixer": knows the way around a bureaucracy, makes two calls, attests it's done |
| Person, plain web app | Fleet-as-a-service | Non-technical user orders from a form; expert has productized their agents |

## Core insight 2 — one rail, two deliverable classes, any input state

**The class defines what the expert returns, not what the requester sends.**

| Class | Expert returns | Attestation pins |
|---|---|---|
| `review` | Signed verdict (approve / approve-with-changes / reject) + structured notes | `artifact_hash_in` (the reviewed artifact) — no output hash |
| `execution` | The outcome itself, done in the expert's own environment | `artifact_hash_out` (+ `artifact_hash_in` when an input existed), plus schema-defined proof |

The input artifact is a separate, optional, completeness-agnostic field of the order:

| Input state | Class | Example |
|---|---|---|
| Nothing | `execution` | "Register the domain, set up the DNS" — from zero |
| Half-baked | `execution` | The Facebook ad — expert *finishes* it |
| Finished | `review` | The report — expert signs off |

Rules:
- Class is **declared at order time and never switched mid-order**. A `review` order
  never silently becomes an edit (redline delivery is a roadmap class).
- `execution` acceptance evidence is **schema-defined per order**. Examples like "URL
  returns 200" or "DNS record exists" are *illustrative only* — execution proofs need a
  trusted oracle (who fetches the DNS?). **Do not implement a fetcher this week.**
- Dual hashes make the two blobs identifiable forever; they do **not** decide "already
  broken vs expert broke it" — that stays semantic (jury territory, stubbed).
- **Access handover is out of protocol.** We do not escrow credentials. Protection =
  certification, bond, and attributable signature — noting bonds and disputes are
  stubbed this week (Known limits). Roadmap: scoped-credential escrow, and a signed
  hand-over receipt whose hash rides in the attestation.

## Core insight 3 — incentive symmetry (production thesis, NOT a this-week claim)

> Production thesis: pay-on-any-verdict removes the incentive to approve dishonestly;
> broadcast-the-fix removes the incentive to reject dishonestly. In the full protocol,
> the expert's only profitable strategy is being right.

**Only the first half ships this week.** Do not use the symmetry slogan in the
90-second hook, and never claim the incentive system is closed — Known limits
(rubber-stamp) is the honest weekly statement, and the two must never contradict on
camera. This section is README/theory and a roadmap slide, **not a build prompt** —
nobody implements "just one quote message."

- **Payment releases on the signed attestation, whatever the verdict** (Tier 1). You
  bought judgment, not approval — a reject is a delivered product. If payment depended
  on approval, every expert would shade toward approve (the audit-firm failure mode).
  The only clawback is a provable schema violation.
- **A reject doubles as an RFQ** (Tier 3 / roadmap). The reject attestation's defect
  list + input hash convert one-click into a new `execution` order broadcast to experts
  on the same cert tag; peers quote on-chain; the client sees the **median**; the
  accepted quote becomes a normal order. The market, not the rejector, prices the fix.
  Open game theory (Sybil quotes, collusion, fee-farming loops) is acknowledged, not
  solved.
- **Three backstops against reject-farming** (ship tiers marked):
  1. Rejector may bid on the fix but is **flagged as the rejector** (needs the RFQ
     market — Tier 3).
  2. **Reject-rate as reputation signal** feeding second-opinion audits (Tier 2).
  3. **The fix order is always optional** — the client can take the verdict and walk
     (Tier 1; this is the only backstop live in the demo).
- Schema cost now: `defects[]` + optional `prior_attestation_ref`. Two fields, the full
  market later.

## Stakeholders

1. **Requester** — person or agent (or both). Orders a review or an outcome, sees the
   price, locks the funds. Surface: `handoff_verify` MCP tool from any agent session
   (Claude Code, Cursor, desktop), or a plain web form calling the same API.
2. **Expert / provider** — a certified human. Sells *judgment and standing behind their
   signature* — never access-peddling or influence. Works bare-handed or with their own
   fleet. Claims gated by certification tags. Deliverable: signed attestation per class.
3. **Dispute jurors** — the same expert class, empaneled m-of-n on challenge, paid for
   the poll. (Hackathon: stub/architecture.)
4. **Certification issuers** — professional bodies, employers, World ID for personhood
   (personhood ≠ professional credential; distinct tag types in the registry).
   (Hackathon: allowlist stub behind the real issuer interface.)
5. **The protocol** — **fee = 0 this week.** Fee mechanics (dispute pool, bonds) are
   roadmap; collecting a fee into an account that does nothing looks like a skimming
   wallet. One line in the video: "protocol fee elided in the demo." No new token, ever
   pitched in HBAR terms.

## The order lifecycle (state machine)

```
POSTED        order envelope on HCS (spec + class + cert tag + price + deadline
              + acceptance schema + optional input artifact hash + schema_version)
              funds locked in escrow; scheduled payment created (PAY is the default)
CLAIMED       first valid claim from a certified account wins; CONSENSUS TIMESTAMP
              is the truth — UIs display optimistically but must handle "you lost
              the race" when the mirror confirms an earlier claim. Claimant gets a
              claim-timeout that is SHORT relative to the order deadline (a lazy
              claimant must not be able to hold funds hostage to the deadline)
DELIVERED     expert publishes the signed attestation on HCS. The expert's key
              signs the HCS message ONLY — it is NOT a schedule key. The escrow
              service validates the attestation against the order schema, then
              platform verifier + schedule-admin ScheduleSign → payment fires.
              The payout step is an IDEMPOTENT RETRY (never double-pay): if the
              service is down when the expert signs, the attestation stands on
              HCS and payment lands on recovery
SETTLED       payment executed; mirror-node confirmation in-app; Hashscan link
— CLAIM-TIMEOUT claimant idle past claim-timeout → ScheduleDelete the payment to
              that claimant → re-open ONCE → new claimant gets a FRESH schedule.
              (Claim-timeout and order-deadline expiry are DIFFERENT events.)
— TIMEOUT     unclaimed at order deadline → schedule expires unexecuted → funds
              return to requester
— VIOLATION   provable (mechanical) schema violation → ScheduleDelete — the only
              clawback path. The check script is open-source, so a false clawback
              is auditable; the expert keeps HCS proof; appeal = stubbed jury
```

**Escrow keys (2-of-3 threshold), assigned:** (1) requester session key, (2) platform
verifier key, (3) schedule-admin key. Early-execute = verifier + admin co-sign after
validating the expert's attestation; clawback = requester + platform after a mechanical
schema-fail. **Honest admission (also in Known limits): verifier and admin are both
operated by us this week — payout liveness and schema adjudication are trusted-platform.
A compromised backend has quorum.** Decentralizing the verifier is the production
roadmap; two Node processes on one team are not two custodians and we don't pretend
otherwise.

**Day-1 spike (P1, hour 1):** validate ScheduleCreate with payee unknown at post time —
Hedera's Schedule Service normally wants a fully formed inner transfer, so **expect the
fallback**: funds still lock into the escrow account at POSTED and the payee-less HCS
envelope still publishes; the schedule is created *at claim time* (payee known),
preserving pay-by-default from the moment of claim; the post→claim window is protected
by the threshold key alone (trusted-platform, admitted). If the fallback is the
architecture, the lifecycle above and the demo narration both say "committed at claim"
— decide by end of hour 1, not at 3am, and update this diagram to match reality.

## The attestation, byte-for-byte

An HCS message submitted **from the expert's own Hedera account** (the account
signature is the attestation signature — the expert's key never touches the schedule).
Payload:

```
{ order_id, class, verdict, defects[], notes_hash,
  artifact_hash_in?, artifact_hash_out?,
  cert_tag, schema_version, prior_attestation_ref? }
```

- **Class rule (implement from this line, not from guesses):** `review` sets
  `artifact_hash_in` only; `execution` sets `artifact_hash_out`, plus `_in` when an
  input artifact existed. A missing/extra hash is a schema violation, so this must be
  unambiguous.
- **HCS message size is limited (~1KB, 6KiB hard max).** `defects[]` is a bounded array
  of short structured codes (UI-enforced: max items, max bytes per item); the full
  written review lives in the content store and only `notes_hash` goes on-chain — the
  hash-only rule applies to the expert's notes exactly as it applies to the artifact.
- **Registry changes are HCS messages too** (add/remove/cert-grant on a registry
  topic), so gating is auditable. Key rotation/revocation is roadmap — a compromised
  expert key is identity theft until the registry row is removed (Known limits).
- Verdict + cert_tag + volume are public on a permanent topic: scrapeable metadata
  (an enterprise's reject rate is visible). Known limit; roadmap: hash-committed
  verdicts with reveal-to-parties.

## Money

- HBAR. Price derives from **liability and credential scarcity** (and for execution,
  the requester's stall cost) — not a labor rate. High prices are a feature: the
  signature carries the risk.
- Money is a string, never a float; tinybar/HBAR/display conversions live in ONE shared
  tested module in the schema package.
- **One demo price, committed once:** set on day 1 after checking faucet limits
  (target: a believable professional figure, e.g. 200 HBAR, narrated as a
  stablecoin-denominated stand-in; drop only if faucet math forces it). Decided once,
  never changed on camera.
- **Currency defense** (one line in the close, labeled roadmap): experts in
  weakening-currency economies settle in seconds into a globally liquid digital asset.
  Stablecoin rail + fiat off-ramps: roadmap, with per-rail rules and minimums.

## Web2 wrap — roadmap, not build scope

Blockchain is the backend, not the homework: custodial accounts, fiat off-ramps, nobody
excluded for not understanding wallets. **None of it is built this week** beyond the
expert web app itself; custodial key management is a weeks-scale project.

## Known limits (say them before the judges do — these win over any other doc)

- **Certification is an allowlist this week.** Say exactly: *issuers aren't here;
  scarcity isn't here; the interface is.* Do NOT claim an attacker "burns a scarce
  credential" — this week it's a row we delete.
- **Disputes are stubbed.** The rubber-stamp / auto-reject-bot attack (claim, sign a
  schema-valid garbage attestation, get paid) is real in the hackathon build. Honest
  answer: the attack is attributable forever on HCS; second-opinion audits (Tier 2)
  catch it probabilistically; m-of-n jury + bonds are the production answer,
  architecture shown. Never slash on a 1-1 disagreement; AMBIGUOUS penalizes nobody.
- **The platform is trusted this week** — for payout liveness (expert signed, our
  service must be awake for money to move) and for schema adjudication (false clawback
  is possible; auditable via the open-source check script + the expert's HCS proof).
  Verifier + admin keys are both ours: custodial, admitted, decentralization roadmap.
- **Execution class is schema + architecture**, demoed as roadmap; its proofs need an
  oracle story presented honestly as a trusted-verifier stub.
- **Content availability is centralized** (Supabase). Signed URLs are access control —
  they re-issue; the object persists — but the store itself is one vendor. Pinning /
  replication (IPFS) is roadmap. The on-chain hash is the commitment; parties keep
  their own copies.
- **Hashscan is a viewer, not a dependency** — attestations live on HCS, retrievable
  from any mirror node; the apps read mirror nodes directly.
- **Known limits win in public copy** over every other document, including this brief's
  own theory sections.

## Scope ladder (do not build past your tier)

- **Tier 1 (demo dies without):** escrow + fund-lock; scheduled pre-committed payment +
  early-execute (as specified above); HCS envelopes (hash-only, `class` +
  `schema_version` + `prior_attestation_ref`); content store (**Supabase behind an
  adapter** — P1 owns the project, service key vault-only, signed-URL TTL > claim-timeout
  + review time); lifecycle state machine; shared versioned schema package **shipping
  day 1 with `MockChainAdapter`**; `handoff_verify` MCP; expert web app (inbox → review
  → sign, `defects[]` bounds enforced); attestation format; allowlist registry (on-HCS
  events) + cert gating; mirror-node settlement reads + Hashscan links threaded.
- **Tier 2:** expert-side fleet pre-analysis (Run 2 — optional, cut first); plain-web
  requester form; second-opinion audit; reject-rate reputation signal; budget/approval
  prompt before an agent spends.
- **Tier 3 (stub/slide only, never build):** dispute m-of-n + UI; reject→RFQ fix
  market; `execution` demo path; redline class; custodial web2 wrap; fiat rails; World;
  token; general MCP↔MCP negotiation.

## Demo arc

Run 1 (the hook, ~90s, **recorded**): agentic requester orders a `review` from a coding
session → funds lock on screen → human expert reviews and signs on camera → settlement
confirmed via **mirror-node query in the expert app** (Hashscan link as garnish — its
indexing lag can exceed the 90s). The demo expert is **staged**; claim-timeout is never
exercised on camera; all artifacts fabricated and labeled FAKE (hard rule 7).
Run 2 (Tier 2, optional): the expert's own fleet pre-analyzes before the human signs.
Close (labeled **roadmap**): modality matrix, `execution` class + the Facebook ad as
demand evidence, reject→RFQ market, one line of currency defense.

**Recording rules:** the judged recording shows **real testnet transactions or is
explicitly labeled simulation — mock tx IDs never appear in the video** (they 404 on
Hashscan). Record a clean testnet run EARLY in the week; the Sep 11 recording is the
polish pass, not the first attempt. Fallback for a flaky testnet on the 11th = the
earlier real-testnet recording, never `MockChainAdapter` output. Round 1 judging is
asynchronous — **the video IS the submission**. Freeze Sep 11, submit with margin.

## Team seats + day-1 sequence

| Seat | Owns |
|---|---|
| P1 Protocol/chain | Escrow, schedule + early-execute, HCS, Supabase project, lifecycle, mirror/Hashscan threading |
| P2 Requester integration | `handoff_verify` MCP, demo requester session (via **Hedera Agent Kit** — see below), budget prompt (Tier 2 only) |
| P3 Expert surface | Expert web app: inbox, review workspace, verdict editor with `defects[]` bounds, sign action |
| P4 Trust, registry & story | Schema package + `MockChainAdapter`, attestation format, registry + gating, README/video/rubric |

**Hedera Agent Kit is ON the build path**: the demo requester agent performs its chain
actions through Agent Kit tools — the bounty named it; dropping it risks the bounty even
with a coherent product. Verify current rubric wording (open item 6).

**Day 1, in order:** (0) `AI-USAGE.md` in the same commit as the first source file;
(1) P1 runs the ScheduleCreate spike against the pre-written fallback tree; (2) P4
ships the schema package + `MockChainAdapter` **first, pairing with P2 if needed — the
mock is tiny and everything queues behind it**; (3) CI action (`tsc --noEmit` + unit
tests on PR) + gitleaks hook with the first scaffolding; (4) P2/P3 build against the
mock from hour one; (5) **mock→testnet cutover deadline: Mon Sep 7 night — P2/P3 run
against P1's real adapter before Check-in #1 (Tue 11:59am)**; after cutover the mock is
a test fixture only.

## Hard rules (breaking these breaks the product)

1. Task/artifact content NEVER goes on-chain — hashes only (this includes the expert's
   notes: `notes_hash`, never the text).
2. Never commit keys, seeds, or operator IDs; `.env` only; rotate if leaked. Per-dev
   testnet accounts for development; the shared operator key (vault-only) touches only
   shared infra. gitleaks hook from day 1 (and no `--no-verify` on money-path commits).
3. Payment default is PAY, not refund.
4. Never slash on a single disagreement.
5. Testnet only. No mainnet, ever.
6. From Scratch: no project code before Sat Sep 5 12:00am UB. `AI-USAGE.md` from the
   first code commit, appended every session. Commit small and often; never force-push.
7. **Demo artifacts are fabricated only** — never real contracts, filings, PII, or
   anything that could read as a real professional opinion; label them FAKE on screen.

## Engineering agreements

- TypeScript strict; no `any` and **no `@ts-ignore`** near money or verdicts.
  Money-path code (hashing, envelope validation, escrow key composition, tinybar
  conversion) has unit tests.
- Minimal CI: one GitHub Action, typecheck + unit tests on PR. If it's red, fix
  forward — never push to `main` to dodge it.
- Lockfiles committed + `.nvmrc` — four laptops, one dependency truth.
- Schema versioning: every envelope/attestation carries `schema_version`; breaking
  changes bump the version and old versions stay parsable (additive-first design).
- Every Hedera call surfaces its tx ID; thread it, never swallow it. Settlement state
  is read from mirror nodes, not from "we sent it."
- Lane branches → PR into `main`. Prefer boring and observable.

## Tooling

- **Git repo** = anything an agent session needs to build correctly. **Linear** =
  human coordination (issues, cycles on check-ins, decision log) via Linear MCP —
  agents never depend on Linear at build time. **NotebookLM** (one shared notebook) for
  human study; conclusions written back to the repo. **Telegram/Discord** + ETHGlobal
  Discord. **Vault** for the operator + Supabase service keys. Architecture diagrams are
  Mermaid in `architecture.md`, not a drawing tool. **OBS/Loom** recording. **Hashscan + mirror-node REST** bookmarked day 1.
- Skipped: shared SSH host, Notion, anything beyond the one CI action.

## Open human items (before Sat 00:00)

1. Confirm all four teammates applied on ETHGlobal (deadline was Fri Sep 4 11:59am UB).
2. Put names on the four seats.
3. Verify the exact submission deadline on the live event page (Sep 12 vs 13 — garbled).
4. Ratify the demo price point (proposed: 200 HBAR, pending faucet check).
5. One person owns the video.
6. Verify the Hedera bounty rubric wording (Agent Kit required?) — decides how P2
   builds the requester agent.

Items 2 and 5 are closed by `team-seats.md`. The event calendar and check-in deadlines
live on the Linear board, not in this repo.
