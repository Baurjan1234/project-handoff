# apps/requester — the demo requester agent

**Owner: P2 Tseegii.**

## What this app owns

- The demo requester session that orders a `review` from a coding session.
- The **x402 client**: it must complete at least one real paid request end to end,
  because the prize requires exactly that and the video must show it happening.

## What this app must never do

- **Never sign with a wallet extension.** The reference implementation signs through
  HashPack because its buyer is a person. Our buyer is an agent, so the signer is
  programmatic and the key is an ECDSA testnet account.
- **Never appear in a recording using `MockChainAdapter`.** Mock transaction IDs 404 on
  Hashscan. Real testnet or explicitly labelled a simulation.
- **Never import the Hedera SDK.** Go through `@handoff/chain`.

Hedera Agent Kit is on the build path here because it pairs naturally with x402, not
because the prize requires it.
