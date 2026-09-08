# The x402 payer signer lives in packages/chain, beside the ChainAdapter

**Decision.** `packages/chain` exports an `X402Signer` that builds the Hedera
`TransferTransaction` for the service fee and partially signs it with the requester's
ECDSA key, which is step 2 of the x402 flow in root `CLAUDE.md`. It sits beside
`ChainAdapter`, not inside it, so `MockChainAdapter` and the schema treaty do not
change. `apps/requester` depends on `@handoff/chain` and implements the `PaymentSigner`
port in `apps/mcp/src/mcp/client.ts` with it. The `@x402/hedera` dependency goes in
`packages/chain` and nowhere else. Tseegii (P2) authors the signer file inside
`packages/chain`, Khishgee (P1) reviews it. Neither `apps/requester` nor `apps/mcp`
imports the Hedera SDK or `@x402/hedera`.

**Why.** NAS-35 laid out three options. Extending `ChainAdapter` would put a key-touching
shape in `packages/schema`, against that package's own rule, and give the mock a method
that cannot produce a signature Blocky402 accepts; it would also be a `breaking` PR to
the treaty on cutover day. A named exception letting `apps/requester` import
`@x402/hedera` directly is fastest but breaks the root rule that nothing outside
`packages/chain` imports the Hedera SDK, and that rule exists so no agent session can
move funds on its own. The separate export keeps both rules intact and touches no
interface anyone else builds against.

The cost of this option was P1's time on the critical path. That cost is removed by
having Tseegii write the file: `docs/team-seats.md` already collapses Khishgee and
Tseegii into one chain unit when P1 is under load, and tonight P1's hours go to the
schedule rerun and the cutover. The file is small, the port it satisfies is already
defined and tested, and the review is one person reading one file.

Closes the question `2026-09-05-402-lives-in-an-http-resource-server.md` confined to
`apps/requester` but did not answer.

**Consequences.**

- `packages/chain/CLAUDE.md` lists the x402 signer among what the package owns, with the
  authorship note. `apps/requester/CLAUDE.md` says x402 signing comes from
  `@handoff/chain` and names `@x402/hedera` as also forbidden there.
- `apps/requester/package.json` depends on `@handoff/chain`. `packages/chain` gains the
  `@x402/hedera` dependency in the implementation PR, not this one.
- The signer holds the requester's ECDSA key in memory server-side only, the same
  constraint as every other key in `packages/chain`. Nothing in it reaches a browser
  build.
- Path-based lane ownership is not changed. Tseegii's file in `packages/chain` is a
  reviewed guest contribution, and P1 stays the owner of the package.
- NAS-35 closes when this lands on `main`. NAS-24 and NAS-16 are unblocked from the
  moment the ruling is read.
