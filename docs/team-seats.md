# Team Seats — Handoff @ ETHOnline 2026

Assigned 2026-09-04, pre-kickoff. Closes open item 2 of the project brief.

## The four seats

| Seat | Who | Role | Owns (Tier 1) | Skillset the seat demands |
|---|---|---|---|---|
| **P1** | **Khishgee** | Protocol / chain | Escrow account + fund-lock, ScheduleCreate + early-execute path, HCS topics, Supabase project + content adapter, lifecycle state machine, mirror-node reads, Hashscan threading | Strongest backend/TS; comfortable reading SDK source when docs fail. Everyone queues behind this seat |
| **P2** | **Tseegii** | Requester integration | `handoff_verify` MCP server, demo requester session on **Hedera Agent Kit**, order packaging + fund-lock call | TS + MCP; owns the bounty-critical Agent Kit surface |
| **P3** | **Jack** | Expert surface | Expert web app: inbox → review workspace → verdict editor (`defects[]` bounds) → sign action; lost-claim-race UX | React/frontend speed + product taste — this app is on camera for most of the demo |
| **P4** | **Nasaa** | Trust, registry & story | Schema package + `MockChainAdapter` (day 1, hour 1 — before anything else), attestation format, registry + cert gating, README, the video, rubric mapping, scope-cut authority | Generalist: solid TS for schema work + writing/communication; Linear admin and clock-owner |

## Linear identities

The board is the only place work status lives. These are the accounts to assign to.

| Seat | Who | Linear account |
|---|---|---|
| P1 | Khishgee | Batkhishig |
| P2 | Tseegii | Tseegii Tseegii |
| P3 | Jack | baurjanjalgaskhan@gmail.com — display name not set |
| P4 | Nasaa | Nasantogtokh Amarsaikhan, project lead |

## Cross-cutting duties (named, not "someone")

| Duty | Owner | Notes |
|---|---|---|
| Video (test recording early, final cut Sep 11) | Nasaa | Closes open item 5 |
| Day-1 ScheduleCreate spike | Khishgee, with Tseegii sitting in | Spike outcome (schedule-at-post vs at-claim) changes P2's MCP calls |
| Mock→testnet cutover (Mon Sep 7 night) | Khishgee drives, all four present | One of the two mandatory co-located sessions (the other: kickoff night) |
| Check-in submissions (Sep 8 + Sep 11, 11:59am UB) | Nasaa | Dates and deadlines live on the Linear board |
| On-camera expert in the demo | Jack (fallback: Nasaa) | Khishgee + Tseegii drive the terminal side |
| **Live judging round 2, Tue Sep 15** | **UNASSIGNED** | New in v2. Round 1 is asynchronous, round 2 is not. Somebody presents and answers questions |
| ETHGlobal track selection | Nasaa | Done 2026-09-05. Building from Scratch |
| Linear board + decision log | Nasaa | Decisions land in `docs/decisions/` within the hour |

## If a seat wobbles (collapse rules)

- P1 struggling → **Khishgee + Tseegii pair as one chain unit**; the MCP surface thins.
  A thin `handoff_verify` with a working chain beats the reverse.
- P4 overloaded → schema package moves to Tseegii's day-1 morning; Nasaa keeps
  story/video/registry only.
- P3 never merges into anything — the expert app is the demo.
- **P2 is the heaviest lane in v2.** The x402 gate is the prize-qualifying work and it
  sits on Tseegii on top of the MCP tool and the requester agent. If this seat is
  underwater, move other work off it rather than thinning the gate.
- Scope-cut authority is Nasaa's alone (product lead). Nobody quietly builds past the
  tier line.

## Lane ownership in the repo

| Path | Seat |
|---|---|
| `packages/schema` | Nasaa (P4) — the treaty; changes are PRs tagged `breaking` |
| `packages/chain`, `packages/content` | Khishgee (P1) |
| `apps/mcp`, `apps/requester` | Tseegii (P2) |
| `apps/web` | Jack (P3) |
| `docs/`, `README.md`, `.claude/` | Nasaa (P4) |
