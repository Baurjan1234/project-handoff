# Architecture diagrams in Mermaid

**Decision.** `docs/architecture.md` holds the architecture as Mermaid in markdown. No
drawing tool in the build loop.

**Why.** Mermaid is diffable and reviewable in a pull request, and any teammate's agent
can read it and regenerate it when the design changes. A binary drawing goes stale the
first time the lifecycle changes and nobody notices.

**Consequences.** Excalidraw is reserved for the final pitch-deck visual, if we make one
at all.

**Supersedes.** The Excalidraw line in the brief's Tooling section.
