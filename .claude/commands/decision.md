---
description: Record a settled decision in docs/decisions/, with the index line
argument-hint: <what was decided, in a few words>
allowed-tools: Read, Write, Edit, Bash(date:*), Bash(ls:*), Bash(git log:*)
---

Today in Ulaanbaatar is !`date +%F`.

Existing decisions, so you can see the house style and spot what this supersedes:

!`ls docs/decisions/`

## Your task

Record this decision: **$ARGUMENTS**

1. **Establish what was actually decided.** Read back through the conversation. If the
   decision, the reason, or what it overturns is unclear, ask rather than invent. A
   decision file that guesses is worse than none, because the next session will treat it
   as settled.

2. **Write `docs/decisions/YYYY-MM-DD-short-slug.md`** using today's Ulaanbaatar date and
   a slug that names the decision, not the topic. Prefer `x402-gates-handoff-verify` over
   `payments`.

   Four sections, in this order:

   - `**Decision.**` What we will do, stated so someone can act on it without reading
     further.
   - `**Why.**` The reasoning, including the evidence. If it came from a primary source,
     name the source. If it came from a measurement, give it.
   - `**Consequences.**` What changes because of this, including anything that now has to
     be updated elsewhere and any new constraint people will trip over.
   - `**Supersedes.**` Only when it overturns something. Name the file.

3. **Add the index line** to `docs/decisions/README.md` under today's date heading,
   creating the heading if this is the day's first decision. Newest last.

4. **Mark what this supersedes.** If it overturns an earlier decision, add a short
   `> **Superseded** by ...` note at the top of that file. Never delete it; the reasoning
   is why nobody re-litigates.

5. **Propagate.** If the decision changes scope, the lifecycle, a hard rule, or a
   deadline, then `docs/project-brief-v2.md`, `CLAUDE.md` and `docs/architecture.md` are
   now stale. Say which ones and offer to update them, or update them if the change is
   mechanical.

Do not commit. The author decides when this lands and in what commit.
