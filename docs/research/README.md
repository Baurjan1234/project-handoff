# Research notes

**Conclusions and gotchas only.** Never documentation summaries — Context7 pulls live,
version-specific SDK docs into a session, so a summary here is stale weight.

What belongs: things verified against testnet that the docs do not say, or say wrongly.

    ScheduleCreate rejects an inner transfer with no payee — verified on testnet
    2026-09-05, Khishgee. Fell back to schedule-at-claim.

One file per topic, named for the thing learned. Anything that changes what we build
also gets a line in `../decisions/`.
