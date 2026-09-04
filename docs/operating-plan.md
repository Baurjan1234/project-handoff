# Operating Plan — how the team works (2026-09-04, ratified 2026-09-05)

How we organize, share information, and cooperate for the build week. Companion to
`project-brief-v2.md` (the what) and `team-seats.md` (the who); this is the how.

**Ratified with three amendments** on 2026-09-05, each recorded in `decisions/`:
the workspace is normalized into `packages/` and `apps/`; the decision log is a folder
of date-prefixed files, not one append-only file; the brief is renumbered to repo v1.

## The one principle everything hangs on

Information has exactly **three homes**, chosen by who needs it:

| Home | What lives there | Why |
|---|---|---|
| **Git repo** | Everything an *agent session* needs to build correctly: the brief, schemas, per-lane CLAUDE.md, decision log, architecture (as Mermaid), MCP config | Versioned, diffable, present in every clone — an agent that has cloned the repo is fully briefed |
| **Linear** | Everything a *human* needs to coordinate: the event calendar, check-in deadlines, issues, cycles, blockers, who's-doing-what | Realtime, and agents can read/update it via MCP — but never depend on it at build time |
| **Vault** (1Password/Bitwarden) | Operator key, Supabase service key | Never anywhere else |

Everything else (Gemini Notebook, Drive, chat) is a **feeder** — anything decided or learned
there gets written back into one of the three homes or it doesn't exist.

## Repo structure

```
handoff/
├── CLAUDE.md                   ← the root brain every session loads
├── AI-USAGE.md                 ← from the first code commit
├── .mcp.json                   ← ★ checked-in MCP config: Linear + Hedera + Context7
├── .nvmrc, pnpm-lock.yaml      ← one dependency truth across four laptops
├── pnpm-workspace.yaml
├── .github/workflows/ci.yml    ← the one action: tsc --noEmit + unit tests + gitleaks
├── .claude/
│   ├── settings.json           ← permission allowlist, deny rules, SessionEnd hook
│   ├── hooks/                  ← gitleaks pre-commit + AI-USAGE append
│   └── skills/                 ← per-lane skills (hedera-primitive, hcs-envelope, demo-run, rules-check)
├── packages/
│   ├── schema/                 ← P4, day 1 hour 1: types, envelopes, attestation, money module, ChainAdapter + MockChainAdapter
│   ├── chain/                  ← P1: escrow, schedule + early-execute, HCS, mirror reads
│   └── content/                ← Supabase adapter behind a storage interface
├── apps/
│   ├── web/                    ← P3: expert app (inbox → review → sign)
│   ├── mcp/                    ← P2: handoff_verify server
│   └── requester/              ← P2: demo requester session (Hedera Agent Kit)
├── ai-usage/                   ← per-seat session logs, appended by the hook
├── docs/
│   ├── project-brief-v2.md, team-seats.md
│   ├── operating-plan.md       ← this file
│   ├── decisions/              ← date-prefixed ADRs, one per file, plus a README index
│   ├── research/               ← conclusions and gotchas only, never doc summaries
│   ├── links.md                ← Hashscan, mirror-node REST, faucet, ETHGlobal, Linear, Drive
│   └── architecture.md         ← Mermaid diagrams, NOT Excalidraw
└── assets/                     ← fabricated demo artifacts, FAKE-labeled
```

Every package and app gets a short CLAUDE.md ("this package owns X, its contract with
the others is the schema package, never do Y") so an agent working in `apps/web` knows
its lane without loading the whole protocol.

Three details that matter more than they look:

- **`.mcp.json` is checked in.** Claude Code reads project-scope MCP config from the
  repo, so `git clone` plus open Claude Code equals every teammate's agent automatically
  wired to Linear, Hedera, and Context7. No "did you set up your MCP servers?" messages
  ever.
- **Architecture lives as Mermaid in markdown, not in a drawing tool.** Diffable,
  PR-reviewable, and any teammate's agent can regenerate it when the design changes.
  This supersedes the brief's Tooling line. Excalidraw only for the final pitch-deck
  visual, if at all.
- **`packages/` holds libraries, `apps/` holds deployables.** The split makes it obvious
  which things ship and keeps platform keys out of anything with a browser build.

## The MCP stack (per teammate, via the checked-in config)

Four remote servers, verified 2026-09-05. Nothing installs locally and no server holds a
private key. See `decisions/2026-09-05-mcp-servers-checked-in.md`.

1. **Hedera hosted MCP** at `agentic-testnet-mcp.hedera.com` — a managed remote instance
   of the Agent Kit, testnet-scoped by hostname. It runs in RETURN_BYTES mode: it builds
   transactions and the client signs them, so it never sees a key. P1 can poke testnet
   interactively during the day-1 spike; P2 gets the Agent Kit surface the bounty names.
2. **Hedera docs MCP** at `docs.hedera.com/mcp` — one search tool over Hedera's own
   documentation, no auth. The direct fix for the hallucinated-SDK-call failure mode.
3. **Linear MCP** — agents read their lane's issues, update status, log blockers. Humans
   see one live board. One OAuth per person via `/mcp`.
4. **Context7 MCP** — live, version-specific docs for the rest of the stack. Next.js,
   Tailwind, shadcn, Supabase, the MCP SDK, zod, vitest.

That is the whole stack. A fifth needs a stated reason and a decision file.

**Official Hedera Claude Code plugins** are a separate thing from MCP and worth adding
per person: `github.com/hedera-dev/hedera-skills` is an Apache-2.0 marketplace from
Hedera Dev. `native-services-js` covers the Consensus Service and the Hiero JS SDK,
`system-contracts` covers the Schedule Service, `agent-kit-plugin` covers extending the
kit, and `hackathon-helper` validates a submission against the official judging
criteria. Install with `/plugin marketplace add hedera-dev/hedera-skills`.

## Cooperation rhythm

- **Async by default, one fixed sync.** 15 minutes daily at a set hour (pick one that
  survives the UB-midnight event rhythm). Agenda is always: blockers → interface
  changes → cut decisions. Everything else goes through Linear and chat.
- **Sitting together: spend it on the seams, not the lanes.** The two highest-value
  co-located sessions: day 1 (ScheduleCreate spike plus the schema package's birth,
  which is everyone's contract) and the mock-to-testnet cutover Monday night. Solo lane
  work doesn't need a shared room.
- **Interface changes are PRs to `packages/schema` first**, tagged `breaking`, announced
  in the sync. That package is the treaty between the four of us; nothing else needs
  coordination overhead.
- **Decisions land in `docs/decisions/` within the hour.** One short file each. This
  keeps four parallel agent sessions from re-litigating settled questions.
- **Demo recordings and big assets** go to a shared Drive folder (repo stays lean); the
  final video file's link goes in Linear.

## Learning materials in one place

**Gemini Notebook**, the product formerly called NotebookLM (one shared notebook: Hedera SDK,
HCS and Schedule Service docs, Agent Kit README, x402 and Blocky402 docs, MCP spec,
ETHGlobal rules) is the *human* study tool — audio overviews, Q&A.
With Context7 in the stack, the write-back burden shrinks: agents get live SDK docs
themselves, so what goes back to `docs/research/` is only **conclusions and gotchas**
("ScheduleCreate needs X — verified on testnet"), not documentation summaries.
Links: one `docs/links.md` — everything reachable from one file.

## UI/design (artifact-based UI)

No Figma. Sketch screens as quick HTML artifacts in a Claude session (fast to iterate,
shareable as links, disposable), then build directly in React, Tailwind and shadcn/ui.
The screens are simple (inbox, review pane, sign button); a design-tool round-trip costs
more than it saves. The one screen worth mocking carefully first is the **review
workspace** — it's the demo's centerpiece frame.

## What we deliberately do NOT add

Code-review bots (CI plus four humans is enough), Notion (Linear and the repo cover it),
Slack (Telegram and Discord exist), preview deployments (the demo runs local; add only
if setup takes under 10 minutes), any observability stack, and the shared SSH host.

**The meta-rule for the week: if a tool needs more than 15 minutes of setup, or its
absence doesn't block the demo, it's out.** Repo-as-agent-brain, MCP for coordination
and chain access, live docs on tap.

## Sources

- [Hedera AI Agent Kit](https://docs.hedera.com/solutions/ai/agent-kit)
- [Hedera MCP & Agent Skills](https://hedera.com/blog/hedera-mcp-agent-skills/)
- [hedera-agent-kit on npm](https://www.npmjs.com/package/hedera-agent-kit)
- [Context7 MCP server](https://mcpservers.org/servers/context7-mcp-server)
- [Context7 overview](https://www.trevorlasn.com/blog/context7-mcp)
