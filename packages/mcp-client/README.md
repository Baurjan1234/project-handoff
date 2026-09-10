# @hedera-handoff/mcp-client

Order a review from a credentialed human, from inside any agent session. Funds lock up
front, a certified person signs an attestation, payment releases on the signature.
Settled on Hedera.

**Testnet only.** This client refuses any other network.

## Install

Nothing to clone and nothing to build. Point your agent client at `npx`:

```bash
claude mcp add handoff \
  -e HANDOFF_SERVICE_URL=https://your-handoff-service \
  -e X402_PAYER_ACCOUNT_ID=0.0.xxxxxx \
  -e X402_PAYER_PRIVATE_KEY=your-ecdsa-key \
  -- npx -y @hedera-handoff/mcp-client
```

Or as configuration, in `.mcp.json` for one project or `~/.claude.json` for all of them:

```json
{
  "mcpServers": {
    "handoff": {
      "command": "npx",
      "args": ["-y", "@hedera-handoff/mcp-client"],
      "env": {
        "HANDOFF_SERVICE_URL": "https://your-handoff-service",
        "X402_PAYER_ACCOUNT_ID": "${X402_PAYER_ACCOUNT_ID}",
        "X402_PAYER_PRIVATE_KEY": "${X402_PAYER_PRIVATE_KEY}"
      }
    }
  }
}
```

Keep the key in your shell profile and let `${...}` expand it, rather than writing it
into a file you might commit.

## Your key never leaves your machine

This is the client half of the protocol, and it is the half that signs. Two signatures
are produced here, in this process, and only the signatures go over the wire:

- the **service fee**, an x402 payment, sent as the `PAYMENT-SIGNATURE` header;
- the **fund lock**, a Hedera transfer the service builds and you sign, whose debited
  account and fee payer are both you.

The service validates the returned bytes against what it asked for and submits them. It
never holds your key and never signs your transfer. That is why this runs beside you
instead of on a server.

## Configuration

| Variable | Required | What it does |
|---|---|---|
| `HANDOFF_SERVICE_URL` | yes | The Handoff service to order from |
| `X402_PAYER_ACCOUNT_ID` | to order | Your Hedera account, `0.0.x` |
| `X402_PAYER_PRIVATE_KEY` | to order | Its key. Must be **ECDSA** — the portal's default is ED25519 and will be refused with a message saying so |
| `X402_MAX_FEE_TINYBARS` | no | Cap on the service fee you will sign for. Default 1 HBAR; a higher quote is refused rather than paid |
| `HEDERA_MIRROR_NODE_URL` | no | Used to check your balance and key type before anything is signed |

Without a payer account both tools still load. Reads work; ordering fails with the price
in the message rather than a broken tool.

## Tools

**`handoff_verify`** — post an order. Takes a spec, an artifact, a credential tag, a
price in HBAR, a deadline and a claim timeout. Two payments happen, and they are not the
same thing: a small **service fee** for the call, and the **order value** locked in
escrow for the reviewer. The reply keeps them apart.

**`handoff_status`** — read an order back: whether it is claimed, by whom, and once it is
delivered, the verdict, the defect codes and who signed it. Free and ungated.

## What this build does not do

Certification is an allowlist. Disputes are stubbed — a rubber-stamp attestation gets
paid, and is attributable forever on the consensus log. The platform holds the verifier
and schedule-admin keys, so payout liveness is custodial. Content lives with one vendor;
the on-chain hash is the commitment.

## Licence

MIT.
