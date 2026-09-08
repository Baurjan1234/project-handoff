# Notes for the close: the content package owns the hash-verified read, the MCP lane consumes it

**Decision.** `packages/content` exposes one read for the expert's notes: fetch by
`notes_hash`, recompute the hash with `@handoff/schema`'s canonical hashing, and return
the bytes only when they match. Khishgee (P1) owns that function. Tseegii (P2) calls it
from the close reply in `apps/mcp` and renders the notes to the requester. Part 2 of
NAS-39 moves into NAS-37, which is where the close already lives. `apps/mcp` never reads
Supabase directly.

**Why.** The persona review (recorded on the `p4/ux-philosophy` branch as
`2026-09-06-ux-fixes-from-persona-and-laws.md`) found
that the requester's close has to deliver the judgment, and the judgment includes the
notes, not just the verdict and the defect codes. That surfaced as part 2 of NAS-39 in
the chain lane, but the close flow is the MCP lane's, and Khishgee stopped rather than
guess at the boundary. The split follows the existing package rules: content stays behind
the adapter, hashing stays in the schema package so two implementations agree, and the
only thing the MCP lane needs is a read that refuses to hand back bytes that do not
match the on-chain commitment. Putting the verification in the read means no caller can
forget it.

**Consequences.**

- `packages/content` gains a read-by-hash function that calls the schema package's
  hasher. It does not implement hashing; it verifies with it. `packages/content/CLAUDE.md`
  should name the read and the mismatch behaviour, which is P1's path.
- NAS-37 is blocked on that read and grows by one item. NAS-39 closes when the
  claim-window module merges; its part 2 is no longer its scope. Both issues carry a
  comment saying so as of 2026-09-07.
- The interface, meaning the function name, the mismatch error, and whether it returns
  bytes or a signed URL, gets agreed at today's sync. Recommendation: bytes for notes,
  because they are small and the close reply inlines them; signed URLs stay for
  artifacts.
- Nothing on-chain changes. `notes_hash` is still the only thing published, per hard
  rule 1.
