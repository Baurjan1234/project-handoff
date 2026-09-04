# No Gemini Notebook MCP server

**Decision.** The shared notebook stays a human tool. We do not add a Gemini Notebook
MCP server to `.mcp.json`. The community packages are still published under the old
NotebookLM name. The stack stays at four.

**Why.** Three reasons, any one of which is enough.

- **There is no Gemini Notebook API.** Every MCP server for it works by automating a real
  Chrome browser that is logged into a Google account. Adding one means handing an
  unofficial package a live, authenticated Google session on a laptop that also holds
  testnet keys. That is the exact opposite of the reasoning behind
  `2026-09-05-mcp-servers-checked-in.md`, where the hosted Hedera server was chosen
  precisely because it never sees a key.
- **None of them are official.** They are community projects. A fifth server needs a
  stated reason, and "an unofficial browser-driving package for a tool that is already
  the human study surface" is not one.
- **It duplicates what we have.** `context7` and `hedera-docs` already put live,
  citable documentation into a session. The notebook's job in the operating plan is
  human study, and the write-back path is already defined: conclusions and gotchas go
  into `docs/research/`, not into an agent's context automatically.

**The integration path, which needs no MCP.** A person reads in the notebook, and
anything that changes what we build gets written into `docs/research/` or
`docs/decisions/`. That is the three-homes rule doing its job.

**Note.** Google renamed NotebookLM to **Gemini Notebook** in July 2026. The repo now
uses the new name throughout; only `project-brief-v1.md`, which is history, still says
NotebookLM. Sharing a notebook with named people is
reported to require a paid tier, so check that on the account before promising the team
access.

**Reversible if.** Google ships a first-party server with a real API and read-only
scopes. Then it is worth ten minutes to reconsider.
