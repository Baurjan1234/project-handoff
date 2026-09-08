# The first real paid x402 request, and the two things that nearly stopped it

Measured 2026-09-08 by running the MCP process against the hosted Blocky402 testnet
facilitator with the configured payer, and reading the result back off the mirror node.
Conclusions and gotchas only.

## It completed

`handoff_verify`, called over stdio by an MCP client, answered:

```
Service fee settled · 0.5 HBAR
Order posted · #ord_e227a57df9f2438ba1e2a6c661646f49
```

Transaction `0.0.7162784@1788872048.359217143`, `SUCCESS` on the mirror node:

```
0.0.10376659   −50000000   the payer
0.0.10376656   +50000000   the x402 receiver
0.0.7162784      −249217   the facilitator, paying the gas
```

**The payer paid no gas**, which is the whole point of the designated-fee-payer
arrangement, and it is visible in the transfer list rather than taken on faith.

The order itself was posted through `MockChainAdapter` in this run — the escrow account
and topic ids were not yet configured — so `lock_funds` and `submit_envelope` are
`MOCK-tx-*` and 404 on Hashscan. The **fee leg is real**; the order leg is not. Do not
record this run.

## A raw private key has no curve, and the SDK guesses wrong

The first attempt refused to start a payer at all:

```
x402 payer unavailable: the x402 signer needs an ECDSA key, and this one is ED25519.
```

The account was right — `0.0.10376659` is `ECDSA_SECP256K1` on testnet with 1000 HBAR —
and the key was right. The key is stored **raw**: 64 hex characters, optionally `0x`
prefixed. `PrivateKey.fromString` reads raw hex as **ED25519**, so the key-type guard
was doing its job on a key that had already been parsed as the wrong curve.

`apps/web/src/session/keyShape.ts` states the same fact from the other side: DER carries
a curve prefix, raw does not, "so it is the adapter's to decide."

**Rule.** Never parse an x402 payer key with the generic `PrivateKey.fromString`. Raw
hex must go through `fromStringECDSA`, because the x402 scheme is secp256k1 and ECDSA is
the only reading that can be correct. DER names its own curve and is parsed as it
stands. Implemented in `packages/chain/src/compose.ts`.

This is the class of bug unit tests do not catch: every test built a `PrivateKey` object
directly, so no test ever exercised the string the environment actually holds.

## `/verify` can pass and `/settle` still fail

An earlier probe signed with a throwaway ECDSA key that did **not** control the payer
account. Blocky402's `/verify` returned valid, the resource was served and the order
posted; `/settle` then came back `transaction_failed`.

So Blocky402's verification does not fully bind the signature to the account. It is a
payload check, not a settlement rehearsal.

**Consequences, and none of them are a code change.** Our sequencing already survives
this: `/verify` gates serving, settlement happens last, and a failed settlement is
reported rather than hidden — the reply says `Service fee not settled · transaction_failed`
and the order still stands, which is the honest outcome for a service that was in fact
delivered.

What it does change is what anyone may **say**. "The facilitator verified the payment"
does not mean the payment will land. In the video and in front of a judge, the claim is
that the fee **settled**, evidenced by the transaction id and the mirror-node transfer
list — never that verification succeeded.

## Our own gate accepted our own payer

Worth recording because it was broken until this week. A payload built by `X402Signer`
now decodes in `apps/mcp/src/x402/gate.ts` and reaches the facilitator, which answers
with its own verdict. The earlier failure mode was a **local** rejection —
`payment header is not an exact-scheme x402 payload` — caused by this repository
expecting x402 version 1's top-level `scheme` and `network`. See
`x402-blocky402-wire-verified.md`, which was itself wrong about that shape and is now
corrected.
