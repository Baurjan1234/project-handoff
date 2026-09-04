# Timeline lives in Linear, audit triage is dropped

**Decision.** The event schedule, the todo list and the build timeline live on the
Linear board, not in the repo. `docs/audit-triage.md` is dropped and not carried into
the repo at all.

**Why.** Dates and task state are human coordination, which is Linear's home under the
three-homes rule. An agent session does not need the check-in calendar to build
correctly, and a schedule file in the repo goes stale the first time a date moves. The
audit triage was working material for producing the brief; the brief's Known limits
section already carries every conclusion that survived, so the triage adds nothing an
agent needs.

**Consequences.** Every reference to `docs/audit-triage.md` and `docs/event-schedule.md`
is removed from the brief, the operating plan and CLAUDE.md. The brief's precedence line
becomes simply that Known limits wins over any other document in public copy. Deadlines
that gate work still appear in the brief and CLAUDE.md as prose, such as the Monday
cutover and the Sep 11 freeze. If the triage is needed later it can be brought back.

**Where the line falls.** The word "plan" splits in two and the halves live apart.

| Half | Home | Why |
|---|---|---|
| Plan as scope: what gets built, in what order, what is out | Repo | An agent needs it to build correctly. It is already the tier ladder and the build order in the brief |
| Plan as schedule: who does what by when, and where it stands | Linear | It changes hourly, four people write to it, and no build reads it |

A date may appear in the repo only when it changes what an agent builds, and then it is
named in prose rather than copied as a calendar. The Monday cutover and the Sep 11
freeze qualify. Nothing else does. **Linear is authoritative for every date.** If the
repo and the board disagree on a date, the board is right and the repo line is stale.

The board is `https://linear.app/nasantogtokh/project/project-handoff-dbc693664e86`,
recorded in `../links.md` so a session can find it without asking.
