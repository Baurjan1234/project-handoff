# Hard rule 6 reworded: commit granularity is the eligibility requirement

**Decision.** Hard rule 6 now leads with commit granularity and demotes the AI usage
file. AI disclosure is our own choice, not ETHGlobal's requirement.

**Why.** The published rules were read on 2026-09-05. They contain **no AI policy at
all** — nothing requires, prohibits or asks for disclosure of AI tools or AI-generated
code, and the Hedera prize requirements do not mention it either. The rule as written
carried an obligation with no external source.

The same rules do contain something we were treating as hygiene. A repository that
arrives as single commits without proper history is **assumed unqualified by default**
until the team proves otherwise, and repo history is named as the evidence for the
from-scratch requirement. That makes commit granularity a condition of eligibility, not
a preference.

**The new wording.** Commit small and often, one commit per package, per config concern,
per meaningful step. Never force-push and never rewrite history. `AI-USAGE.md` is one
honest paragraph written before submission rather than a per-session obligation.

**Consequences.**

- **We have already breached the spirit of this once.** The first substantive commit
  landed roughly twenty documentation files under one message. Do not repeat it with the
  scaffold.
- The `SessionEnd` hook and the per-seat logs in `ai-usage/` stay, with a changed
  purpose. They are no longer AI disclosure. They are timestamped evidence that the work
  happened during the event, corroborating commit history against the from-scratch rule.
  This amends `2026-09-05-ai-usage-per-seat-logs.md` rather than reversing it.
- The `README.md` still needs a setup, architecture and payment-flow section, which is a
  Hedera prize requirement and unrelated to this change.

**Source.** `../research/ethglobal-rules-verified.md`.
