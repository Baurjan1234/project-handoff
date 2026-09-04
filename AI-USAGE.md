# AI usage

ETHGlobal's rules do not require this disclosure. We publish it anyway, because the
project is about accountability for agent-produced work and it would be odd not to say
how ours was produced.

## How this project was built

Every member of the team used AI coding assistants throughout, primarily Claude Code
running against this repository. The assistants wrote code, drafted documentation,
searched vendor documentation, and read the primary sources behind the design decisions
in `docs/decisions/`. Humans set the scope, made every architectural and product
decision, reviewed the code, and are accountable for what shipped.

Two things are worth being specific about, since vagueness here would undercut the
point of the project.

**Where AI changed the design.** Reading the Hedera prize requirements and Hedera's
Schedule Service documentation with assistance surfaced two facts that reshaped the
build on day one: the prize requires an x402-gated service rather than the Agent Kit
integration we had assumed, and `ScheduleCreate` needs a fully formed inner transaction,
which settles the escrow architecture. Both are written up in `docs/research/` with the
sources.

**Where humans held the line.** Scope-cut authority sits with one person. The tier
ladder in the brief exists so that neither a human nor an agent quietly builds past it.
No key material was ever handled by an assistant, and the MCP server we use for Hedera
was chosen specifically because it returns unsigned transaction bytes and never sees a
private key.

## The session log

`ai-usage/<seat>.md` holds one automatically appended line per assistant session, with a
timestamp, a session identifier, and the files touched. It is not a record of what the
AI decided. It is timestamped evidence that the work happened during the event, and it
sits alongside the commit history for the same purpose.
