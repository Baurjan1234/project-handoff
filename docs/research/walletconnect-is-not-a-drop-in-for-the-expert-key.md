# Hedera WalletConnect: real, right for production, and not a drop-in swap

Read from `docs.hedera.com` through the `hedera-docs` MCP server on 2026-09-08, after
the "Create a Hedera DApp Integrated with WalletConnect" tutorial came up. Conclusions
only.

## The short version

WalletConnect **is** the right production answer for the expert's key, and it is
genuinely different from MetaMask — this is not the same question that got MetaMask
ruled out. But it is **not** a swap of where the key comes from. It changes the shape
of the signing interface, which means it touches `ExpertChain`, `createExpertChain`,
and P3's whole sign path — not just the connect screen.

## The line that matters

From Hedera's own FAQ (`/evm/integrations/wallets/metamask-snap`):

> **"How can I delegate the signing process to MetaMask or WalletConnect when using
> Hedera SDK?** Currently, there is no direct way to delegate the signing process to
> MetaMask or WalletConnect for transactions composed by the Hedera SDK, as they do
> not provide private keys of users."

Our entire expert path is SDK-composed native HAPI: `createExpertChain` builds a
`TopicMessageSubmitTransaction` and signs it locally with a key the app holds. That
model assumes the app *has* a key. A wallet, by design, never hands one over.

So the WalletConnect pattern is not "same code, key comes from a wallet." It is:
serialize the transaction, hand it to the wallet over the WalletConnect session, the
**wallet** signs and executes it, and the dApp gets a result back. The app never holds
a key and never calls `.execute(client)` for that transaction at all.

## What that costs, concretely

- **`ExpertChain` changes shape.** `submitMessage(topicId, contents)` currently
  resolves through a local `Client` the factory owns. Under WalletConnect it becomes
  a request/response over a session that can be rejected, time out, or land on a
  phone the expert is holding. `close()` becomes session teardown, not client close.
- **`createExpertChain`'s `privateKeyDer` parameter stops making sense**, and with it
  the closure-held-key design and its leak tests — which exist precisely because the
  app holds a key. Under WalletConnect there is nothing to leak, which is better, but
  it is a different file, not a patched one.
- **P3's sign path and its tests** assume a synchronous local signature. Wallet
  approval is a user-in-the-loop async step with its own UI states (pairing, pending
  approval, rejected, session expired).
- **New infrastructure:** a WalletConnect/Reown project id (a signup), the pairing
  UI, session persistence across reloads, and QR or deep-link handling.
- The official tutorial is a **CRA** template doing **HTS token transfers**; our app
  is Vite and our transaction is an **HCS message submit**. The pattern transfers;
  the code does not.

## Why it is still the right production answer

It removes the one genuinely uncomfortable thing about the current build: the expert
pastes a private key into a web form. Everything around that is done carefully —
masked field, `SecretKey`, closure-held, `scrubHex`, never in React state — but the
honest version of it on camera is still "paste your key," and a wallet is what a real
expert would expect. It also strengthens the product's core claim rather than
weakening it: the expert's key never leaves their wallet, so "the expert signed this,
not the platform" gets easier to say, not harder.

Supported wallets on Hedera today: HashPack, Kabila, Blade. MetaMask appears in the
tutorial too, but only through the EVM path, which cannot sign the HAPI transaction we
actually need — see `2026-09-08-custody-onboarding-and-wallets-stay-out.md`.

## Recommendation

**Roadmap, not this week.** It is Sep 8, freeze is Sep 11, and P3's pasted-key connect
flow is already shipped, tested (180 web tests) and demo-ready. Replacing a working
signing path with a user-in-the-loop async one three days before a recording trades a
cosmetic improvement for a real chance of nothing working on camera. The demo expert
is staged anyway, which the brief already says out loud, so "paste the key" is not a
credibility problem in the demo — it is a product problem for afterwards.

If it is wanted before freeze it needs Nasaa's ruling, because it is P3's lane, it
changes an interface in `packages/schema`'s orbit, and it is a scope addition rather
than a fix.

## If it is built later, the seam to build it behind

`createExpertChain` should take an **abstract signer** rather than a key string —
something whose contract is "here is a transaction, come back with a result" — so a
local key and a WalletConnect session are two implementations of one thing and
`packages/chain` never learns which it has. That is a small refactor while there is
one caller; it is a much larger one once the wallet path is half-built inside
`apps/web`.
