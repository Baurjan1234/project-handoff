# apps/mcp — handoff_verify, and the x402 gate in front of it

**Owner: P2 Tseegii.** This lane carries the prize qualification requirement.

## What this app owns

- The `handoff_verify` MCP tool: an agent orders a review from any session.
- **The x402 payment gate in front of it.** This is the qualifying requirement and
  nothing substitutes for it.
- Order packaging and the fund-lock call.

## The gate, implemented from this

1. Client calls the tool. Server answers **HTTP 402** with payment requirements.
2. Client builds a Hedera `TransferTransaction`, partially signs with its own **ECDSA**
   key, and pays no gas.
3. Client retries with the base64 payload in the **`X-PAYMENT`** header.
4. Server posts it to the facilitator's `/verify` and serves on success.
5. Facilitator co-signs as designated fee payer and `/settle` submits it. Settlement is
   asynchronous and returns a Hedera receipt.

Facilitator is `https://api.testnet.blocky402.com`, network `hedera:testnet`. Never
`api.blocky402.com`, which is mainnet.

## What this app must never do

- **Never confuse the two money flows.** The x402 micropayment is the service fee for
  calling the tool. The order value is the price of the judgment and it goes to escrow.
  Different rails, different accounts, different sizes.
- **Never reuse the escrow threshold key as the x402 receiver.** Separate accounts.
- **Never use USDC.** HBAR is native and needs no token association.
- **Never import the Hedera SDK.** Go through `@handoff/chain`.

## Reference

A complete working x402 flow, including a facilitator, lives on the
`templates/x402-pay-per-use` branch of `hedera-dev/scaffold-hbar`. Read
`../../docs/research/x402-reference-implementations.md` first: it names the two
adaptations we need and the one open question about whose facilitator that is.

Hedera Agent Kit is optional here, not required. If it competes with the gate for your
time, the gate wins.
