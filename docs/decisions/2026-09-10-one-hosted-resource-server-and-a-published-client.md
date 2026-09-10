# One hosted resource server, and a client published to npm

**Decision.** The resource server runs once, on the team VPS, at
`https://api.the-handoff.xyz`. Everyone points at it rather than running their own. The
client half of `apps/mcp` is published as **`@hedera-handoff/mcp-client`**, so ordering
needs `npx` and three environment values instead of a clone of this repository.

The expert app's content store moves with it: `VITE_CONTENT_URL` is
`https://api.the-handoff.xyz/content`, not a tunnel out of somebody's laptop.

## Why

Two things that were true on Sep 8 stopped being true on Sep 10.

**One shared server with many payers was impossible.** `lockFunds` debited the requester
and signed as the server's operator, so any payer who was not the operator failed
`INVALID_SIGNATURE` at the fund lock — measured in
`docs/research/x402-first-paid-request.md`. The only working shape was one resource
server per developer. `2026-09-08-requester-signs-the-fund-lock.md` fixed that and it
landed in PR #35: the requester signs the transfer on their own machine and the server
validates the returned bytes. A shared server is now the *better* shape rather than an
impossible one.

**Ordering required a clone.** `.mcp.json` ran `pnpm --filter @handoff/mcp mcp`, which
needs the workspace, `tsx`, and both workspace packages. That is a strange price for a
tool whose whole value is that it is one line of configuration in somebody else's agent
session. The published bundle is 31 KB and reads the same source; there is one
`handoff_verify` in this repository and it is still the one in `apps/mcp`.

Proven end to end on 2026-09-10, installed from npm into an empty directory with no
clone, against the deployed server: fund lock
`0.0.10376659@1789043921.305490999`, SUCCESS, requester `0.0.10376659` debited
`100263325` tinybars — the order value plus their own gas — escrow `0.0.10422187`
credited `100000000`, service fee settled. The operator appears nowhere in that transfer.

## Consequences

- **The client's key never leaves the caller's machine, and that is what fixes the
  packaging question rather than a header.** A remote HTTP MCP endpoint was the obvious
  shape and it is the wrong one: signing needs the key, so a hosted MCP would have to be
  handed the key on every call. "No clone" and "the key stays local" are compatible only
  because a published package is not a clone.
- **The deploy must stay a single long-lived process.** `PendingPayoutStore` is an
  in-memory `Map` (`packages/chain/src/pending-payout.ts`), so a claim recorded in one
  instance and a signature arriving at another is a payout that never fires. No
  serverless, no second replica. This was already a known limitation of the payout
  bookkeeping; hosting is what makes it a deployment constraint.
- **The operator key now lives on shared infrastructure**, which hard rule 2 allows and
  nothing else does. It is in `/etc/handoff/handoff.env`, `chmod 600`, outside the
  repository, loaded by systemd. `X402_FACILITATOR_URL` is deliberately unset so the
  testnet default cannot be overridden into mainnet.
- **The HTTP contract between client and server has no version.** A published client is
  pinned by whoever installed it; the wire changed twice this week (the 402 now carries a
  fund lock, a malformed body answers 400 rather than 402). `npx -y` fetches `latest` so
  the common path is fine, but a pinned or cached client talking to a newer server fails
  in a way that names nothing. Known gap, recorded in `packages/mcp-client/CLAUDE.md`.
- **The npm scope is `@hedera-handoff`.** `handoff` was taken. The published name is
  deliberately *not* `@handoff/mcp`: that name already exists in this workspace as a
  private package, and two things with one name is how a private package gets published
  by accident.

## Supersedes

`2026-09-08-custody-onboarding-and-wallets-stay-out.md`, the finding headed **"Deployment:
nothing needs deploying, and no REST API needs building."** That was accurate when it was
written — the paid path did work on localhost, and the facilitator only ever calls
outward, so no public URL was needed for x402 itself. What it did not anticipate is that
a shared server would become possible and then become the point: it is what lets a
teammate, a judge, or an agent on a machine that has never seen this repository post a
real order. The rest of that file stands, custody included.
