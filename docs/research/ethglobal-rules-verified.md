# ETHGlobal rules, read 2026-09-05

Read from the published rules page. Two findings that change how we work.

## AI disclosure is not required

**The rules contain no AI policy at all.** Nothing requires, prohibits, or asks for
disclosure of AI tools, AI-generated code, or an AI usage file. The Hedera prize
requirements do not mention it either. `AI-USAGE.md` is our own invention, carried in
from the brief before anyone read the rules.

It is still worth keeping, but as a short honest note rather than a hard rule, and the
per-session log serves a different purpose than the one it was built for. See below.

## Commit history is a qualification requirement, and this is the one that bites

Quoting the rules directly:

> Any repositories with single commits of large files without proper history will be
> default assumed to be unqualified unless proven otherwise.

Also required: begin the project at kick-off, disclose any pre-existing work in writing
and in the submission, and clearly document what existed before the hackathon. The
evidence they name is repo history, video and description.

**This is the real content of hard rule 6.** "Commit small and often, never force-push"
is not hygiene advice, it is how the project stays eligible. A tidy repo that arrives as
two or three large commits is presumed unqualified until we argue our way out of it.

**We have already done the thing the rule warns about once.** The first substantive
commit landed roughly twenty documentation files under one message. Do not repeat that
pattern with the scaffold. One commit per package, per config concern, per meaningful
step.

## What the per-session log is actually for

The `ai-usage/<seat>.md` hook records a timestamp, a session id, and the files touched.
That was built as AI disclosure. It is not: it says nothing about how AI was used.

Its real value is now clearer. It is a **timestamped record that the work happened during
the event**, corroborating the commit history against the from-scratch requirement and
the obligation to document what existed beforehand. Keep it for that.
