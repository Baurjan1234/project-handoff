# apps/requester — empty, and the client is not here

**Owner: P2 Tseegii.**

## Read this before you look for the requester

**There is no code in this directory and the demo requester does not live here.**
`src/index.ts` is `export {};`. Anyone reading the repo layout and opening this folder
expecting the x402 client finds nothing, so it is said here first.

The requester that completes a real paid request end to end is an **agent session**
speaking MCP — Claude Code, Cursor, any client — pointed at the published tool:

| Where | What it is |
|---|---|
| `../mcp/src/mcp/client.ts` | The x402 client. Builds the payment, signs it through `@handoff/chain`'s `X402Signer`, retries with `PAYMENT-SIGNATURE`, reads the receipt |
| `../mcp/src/mcp/main.ts` | The stdio MCP server that exposes `handoff_verify` and `handoff_status` to that session |
| `../../packages/mcp-client` | The build product, published as `@hedera-handoff/mcp-client`, so ordering needs no clone |
| `../../.mcp.json` | The `handoff` server entry an agent session actually uses |

A plain requester **web** form is Tier 2 and out of scope this week; see
`../../docs/ux-philosophy.md`.

## Why the directory still exists

Whether it is deleted is a scope cut, and **scope-cut authority is Nasaa's alone**. It
stays until P4 rules, with this file making the situation unambiguous rather than a
reader inferring it from an empty package.

## If anything is ever built here

- **Never sign with a wallet extension.** The reference implementation signs through
  HashPack because its buyer is a person. Our buyer is an agent, so the signer is
  programmatic and the key is an ECDSA testnet account.
- **Never appear in a recording using `MockChainAdapter`.** Mock transaction IDs 404 on
  Hashscan. Real testnet or explicitly labelled a simulation.
- **Never import the Hedera SDK, and never import `@x402/hedera`.** Go through
  `@handoff/chain`. The x402 payment is built and partially signed by its `X402Signer`,
  which plugs into the `PaymentSigner` port. Decided in
  `../../docs/decisions/2026-09-07-x402-signer-lives-in-packages-chain.md`.
- **Never fork the client.** There is exactly one `handoff_verify` in this repo and it
  lives in `apps/mcp`, where the tests and the money path are.

Hedera Agent Kit is optional, not required. It never made it onto the build path here
because the gate took the lane's time, which is the trade the root CLAUDE.md calls for.
