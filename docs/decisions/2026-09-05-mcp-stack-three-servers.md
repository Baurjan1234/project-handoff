# MCP stack is three servers

> **Superseded** by `2026-09-05-mcp-servers-checked-in.md`. The premise that Agent Kit
> ships a local MCP package was wrong, and a fourth server earned its place. The
> reasoning below still holds for why the config is checked in.

**Decision.** `.mcp.json` is checked into the repo with exactly three servers: Linear,
Hedera Agent Kit, and Context7. A fourth needs a stated reason.

**Why.** Checking the config in means a clone plus opening Claude Code equals a wired
session, with no setup messages in chat. Linear keeps human coordination out of the
repo. Agent Kit is on the build path for the bounty anyway and doubles as an interactive
way to poke testnet during the day-1 spike. Context7 pulls real, version-specific SDK
docs into a session, which is the direct fix for the hallucinated-Hedera-call failure
mode the audits flagged.

**Consequences.** Agents never depend on Linear at build time. Anything Linear knows
that a build needs gets written into the repo.
