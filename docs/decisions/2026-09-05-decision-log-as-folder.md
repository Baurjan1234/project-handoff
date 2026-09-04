# Decision log is a folder of dated files

**Decision.** `docs/decisions/` holds one file per decision, named
`YYYY-MM-DD-short-slug.md` using the Ulaanbaatar local date. A README in the folder is
the index.

**Why.** A single append-only file conflicts on nearly every merge when four people
append at the end of it during the same hour. Dated filenames give chronology without a
counter anyone has to coordinate.

**Consequences.** Slightly more files than one log. The index in the README has to be
updated with each new decision, which is one line.

**Supersedes.** The operating plan's `docs/decisions.md`.
