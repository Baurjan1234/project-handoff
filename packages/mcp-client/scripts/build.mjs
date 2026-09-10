/**
 * Bundle the MCP client half into one file anybody can `npx`.
 *
 * **This reads the workspace source and changes none of it.** The published
 * artifact is a build product, not a fork: `pnpm mcp` keeps running the same
 * `main.ts`, the tests keep covering it, and there is exactly one
 * implementation to keep correct. Restructuring apps/mcp to make packaging
 * tidy was the alternative and it is the one that could break a money path
 * that is already proven on testnet.
 *
 * The entry point drags in `@handoff/chain`'s root export, which is the whole
 * chain package — escrow, the Hedera adapter, platform key composition. None
 * of that belongs in a client anybody can install, so the bundle is
 * tree-shaken and then checked: `assertNoPlatformCode` fails the build if a
 * platform symbol survived. A grep is a weak guard, but a weak guard that runs
 * every publish beats a comment asking people to be careful.
 *
 * Runtime dependencies stay external. The Hedera SDK is 31 MB of protobuf
 * machinery and bundling it is a fight with no prize; npm installs it beside
 * the bundle instead.
 */

import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const outFile = resolve(here, "../dist/handoff-mcp.mjs");

/** Server-only symbols. If one of these is reachable from the client, the bundle is wrong. */
const PLATFORM_SYMBOLS = [
  "createHederaChainAdapter",
  "HederaChainAdapter",
  "createEscrowAccount",
  "buildEscrowKeyList",
  "executeDirectPayout",
  "PendingPayoutStore",
  "SupabaseContentAdapter",
];

await mkdir(dirname(outFile), { recursive: true });

const result = await build({
  entryPoints: [resolve(root, "apps/mcp/src/mcp/main.ts")],
  outfile: outFile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  treeShaking: true,
  // Kept external and declared as dependencies. Everything else — our own
  // workspace packages — is inlined, which is the whole point: the installing
  // machine has no workspace.
  external: [
    "@hiero-ledger/sdk",
    "@modelcontextprotocol/server",
    "@modelcontextprotocol/server/stdio",
    "@x402/core",
    "@x402/core/client",
    "@x402/hedera",
    "@x402/hedera/exact/client",
    "zod",
  ],
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "info",
  metafile: true,
});

const bundled = await readFile(outFile, "utf8");

const leaked = PLATFORM_SYMBOLS.filter((symbol) =>
  new RegExp(`\\b(?:function|class|const|let|var)\\s+${symbol}\\b`).test(bundled),
);
if (leaked.length > 0) {
  throw new Error(
    `platform code survived tree-shaking and would ship to every installer: ${leaked.join(", ")}. ` +
      `Something in the client import graph reached it — check what apps/mcp/src/mcp/main.ts pulls ` +
      `from @handoff/chain.`,
  );
}

// A key literal in a published artifact is unrecoverable: npm versions are
// immutable. gitleaks guards the repo; this guards the thing that leaves it.
if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(bundled) || /\b302e0201[0-9a-f]{20,}/i.test(bundled)) {
  throw new Error("the bundle contains something shaped like a private key. Refusing to build.");
}

await writeFile(outFile, bundled);

const bytes = Buffer.byteLength(bundled);
console.log(`\nhandoff-mcp.mjs  ${(bytes / 1024).toFixed(0)} KB`);
console.log(`platform-code check: clean (${PLATFORM_SYMBOLS.length} symbols)`);
