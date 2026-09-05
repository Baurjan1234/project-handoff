# x402 on Hedera: two reference implementations, and one open question

Verified 2026-09-05 by reading the repositories directly.

## The find

`hedera-dev/scaffold-hbar` ships starter templates on `templates/*` branches. Two are
directly relevant:

| Branch | Why it matters |
|---|---|
| `templates/x402-pay-per-use` | A complete working x402 flow: facilitator, client, server, wallet signer, buy script |
| `templates/payments-scheduler` | Scheduled on-chain payments, which is our escrow release path |

Scaffold with `npx create-scaffold-hbar@latest --template x402-pay-per-use`.

## What the x402 template actually is

A **pay-per-download file marketplace**. A seller uploads to private MinIO storage and
registers metadata on-chain. A buyer pays in **HBAR** through the HashPack wallet, a
**self-hosted** x402 Hedera facilitator verifies and settles on testnet, and only then
does the resource server issue a short-lived download URL.

**That shape is Handoff's shape.** Pay per request, then receive access to a gated
resource. Our version is: pay per `handoff_verify` call, then the order posts and funds
lock. The MinIO-behind-a-paywall pattern is also our Supabase content store pattern.

Useful files on that branch:

```
facilitator/src/server.ts                    the facilitator itself, Dockerised
packages/nextjs/services/x402/server.ts      the resource server, issues the 402
packages/nextjs/services/x402/client.ts      the paying client
packages/nextjs/services/x402/walletSigner.ts
packages/nextjs/scripts/x402-buy.ts          end-to-end buy script
```

## Two adaptations we have to make

1. **Our buyer is an agent, not a browser wallet.** The template signs through HashPack.
   We need a programmatic ECDSA signer, which is what the
   `hedera-dev/x402-inference-pay-per-request-poc` build does instead.
2. **Drop the Solidity.** The template is Hardhat plus a `FileRegistry` contract, and
   Handoff needs no contract. Take the x402 plumbing, leave the scaffold.

## The open question — answered 2026-09-05, they are not the same

**The template self-hosts its facilitator. The prize requires settlement "through the
Blocky402 facilitator."**

They are different programs. The template's `facilitator/package.json` names itself
`x402-hedera-facilitator`, wrapping the `@x402/hedera` reference scheme. We point at the
hosted testnet endpoint `https://api.testnet.blocky402.com` instead, and keep the
template only as plumbing. Details, and the wire shapes both of them speak, are in
`x402-blocky402-wire-verified.md`.

## Also worth knowing

- The template requires a funded **ECDSA** testnet account for facilitator fee-payer
  duties, which independently confirms the ECDSA constraint.
- It is labelled experimental and not audited. Fine for testnet, and we are testnet only.
- It pins Node 20 LTS. Our `.nvmrc` choice should not fight that if we vendor any of it.
