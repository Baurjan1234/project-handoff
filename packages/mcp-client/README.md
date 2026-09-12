# @hedera-handoff/mcp-client

Order a review from a human reviewer, from inside any agent session. The order value
locks in escrow up front, the reviewer publishes a signed attestation from their own
Hedera account, and that attestation is what payout is owed against.

**In this build the platform operator runs the release.** The attestation stands on the
consensus log either way; a verifier service that watches the topic and releases on its
own is the production answer, not this week's.

**Testnet only.** This client refuses any other network.

## Install

Nothing to clone and nothing to build. Point your agent client at `npx`:

```bash
claude mcp add handoff \
  -e HANDOFF_SERVICE_URL=https://api.the-handoff.xyz \
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
        "HANDOFF_SERVICE_URL": "https://api.the-handoff.xyz",
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
| `HANDOFF_SERVICE_URL` | yes | The Handoff service to order from. One is hosted: `https://api.the-handoff.xyz` |
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

**Nothing checks the credential.** A cert tag routes an order to reviewers who claim to
hold it; no registry verifies that either the claimant or the signer does. The reply says
"credential claimed", never "certified", and means it.

Disputes are stubbed — a rubber-stamp attestation gets paid, and is attributable forever
on the consensus log. Payout is operator-run, not automatic. The platform holds the
verifier and schedule-admin keys, so payout liveness is custodial. Content lives with one
vendor; the on-chain hash is the commitment. Protocol fee is zero.

## Licence

MIT.
