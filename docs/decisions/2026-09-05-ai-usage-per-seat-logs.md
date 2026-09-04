# AI usage logged per seat

**Decision.** A SessionEnd hook appends one dated line per Claude Code session to
`ai-usage/<seat>.md`. Root `AI-USAGE.md` holds the written disclosure and points at
those logs.

**Why.** Hard rule 6 requires the disclosure to be appended every session, and relying
on four people to remember at 3am fails. Per-seat files never merge-conflict, unlike
four people appending to the end of one file.

**Consequences.** Seat resolves from `HANDOFF_SEAT`, then the git user name, then
`$USER`, so it needs no per-developer setup. `AI-USAGE.md` itself lands in the same
commit as the first source file, per the hard rule.
