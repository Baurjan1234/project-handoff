# MCP servers, verified and checked in

**Decision.** `.mcp.json` is checked in with four remote HTTP servers. All four are
remote, so nothing is installed, no npx package runs on anyone's laptop, and no server
holds a private key.

| Name | URL | Auth |
|---|---|---|
| `hedera` | `https://agentic-testnet-mcp.hedera.com/mcp` | `x-hedera-account-id` header from `$HEDERA_ACCOUNT_ID` |
| `hedera-docs` | `https://docs.hedera.com/mcp` | none |
| `linear` | `https://mcp.linear.app/mcp` | OAuth, per person, via `/mcp` |
| `context7` | `https://mcp.context7.com/mcp` | none, key optional at user scope |

**Why the Hedera one is the hosted server, not a package.** The official Hedera hosted
MCP server is a managed remote instance of the Agent Kit, and it runs in **RETURN_BYTES
mode only**. It never signs, never submits, and never sees a private key. It builds
transaction bytes and the client signs them. Every chain-execution alternative found was
a third-party npm package that wants `HEDERA_PRIVATE_KEY` in its environment, which
would hand any agent session the ability to move funds. The hostname is also testnet-
scoped, which puts hard rule 5 in the URL rather than in a config value someone can get
wrong.

**Why a fourth server.** The operating plan capped the stack at three and required a
reason for a fourth. `hedera-docs` is Hedera's own documentation search, a single
`SearchHedera` tool, no auth, hosted by Mintlify. It is the most direct fix for the
hallucinated-SDK-call failure mode the audits flagged, and it is authoritative in a way a
general documentation index is not. Context7 stays for the rest of the stack: Next.js,
Tailwind, shadcn, Supabase, the MCP SDK, zod, vitest.

**Consequences.**

- `HEDERA_ACCOUNT_ID` must be exported in each person's **shell profile**, not just
  `.env`. Claude Code expands `.mcp.json` variables from the environment and does not
  read `.env`. If it is unset the Hedera server fails to load, loudly, which is correct.
- Linear needs a one-time OAuth per person, run `/mcp` after cloning.
- Signing stays in `packages/chain`. The MCP server returning bytes rather than
  submitting matches the architecture we already drew, where only that package touches
  the SDK.
- Anyone rate-limited on Context7 adds their own key at user scope. It stays out of the
  repo.

**Supersedes.** `2026-09-05-mcp-stack-three-servers.md`, which assumed the Agent Kit
shipped a local MCP package and capped the stack at three.
