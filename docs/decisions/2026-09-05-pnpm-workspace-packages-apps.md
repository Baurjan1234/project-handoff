# pnpm workspace, packages and apps

**Decision.** One pnpm workspace monorepo. Libraries live in `packages/` (schema, chain,
content). Deployables live in `apps/` (web, mcp, requester).

**Why.** One lockfile and one dependency truth across four laptops, and the schema
package is importable by every seat on day 1 without publishing anything. Splitting
libraries from deployables makes it obvious which things ship, and keeps platform keys
out of any workspace that has a browser build.

**Consequences.** Two workspace globs. The operating plan's original tree, which nested
`schema` under `packages/` but left `chain`, `mcp`, `web` and `content` at the root, is
normalized to this shape.

**Supersedes.** The repo tree as first written in the operating plan.
