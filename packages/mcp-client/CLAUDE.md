# packages/mcp-client — the published client, built from apps/mcp

**Owner: P2 Tseegii.** Published as `@hedera-handoff/mcp-client` so anyone can run the
tool without cloning this repo.

## What this package is

A build product, not a second implementation. `scripts/build.mjs` bundles
`apps/mcp/src/mcp/main.ts` with esbuild and writes one file. There is exactly one
`handoff_verify` in this repo and it lives in `apps/mcp`.

## What this package must never do

- **Never fork the client.** No source lives here beyond the build script. If the client
  needs a change, change `apps/mcp` — the tests are there and so is the money path.
- **Never ship platform code.** The entry point imports `@handoff/chain`'s root export,
  which reaches escrow, the Hedera adapter and platform key composition. Tree-shaking
  drops it and `assertNoPlatformCode` in the build fails if any of it survives. Do not
  weaken that check to make a build pass — find what pulled it in.
- **Never bundle the runtime dependencies.** `@hiero-ledger/sdk`, `@x402/*`, the MCP SDK
  and zod stay external and are declared as dependencies, pinned to the same versions the
  workspace uses. A version that drifts from `packages/chain` is a signer that behaves
  differently from the one we test.

## Publishing

`npm publish` runs the build first (`prepublishOnly`), so a stale `dist/` cannot ship.
`files` is an allowlist: the bundle and the README, nothing else.

**npm versions are immutable.** The build refuses to write a bundle containing anything
shaped like a private key, because a leaked one cannot be unpublished — only deprecated.

Bump `version` by hand. The wire contract between this client and the resource server has
no version of its own yet: if you change the shape of `/orders`, an installed client from
before the change will fail in a way that names nothing. That is a known gap.
