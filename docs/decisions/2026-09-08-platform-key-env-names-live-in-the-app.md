# Platform-key env names live in the app, chain exports a string-taking factory

**Decision.** `packages/chain` exports `createHederaChainAdapter(env, platform)`, which
takes the escrow account id and the two platform keys as **strings** and parses them
itself. Every app composes the adapter through it and **no app outside
`packages/chain` imports the Hedera SDK**. The environment-variable names for those
values — `HANDOFF_ESCROW_ACCOUNT_ID`, `HANDOFF_VERIFIER_KEY`,
`HANDOFF_SCHEDULE_ADMIN_KEY` — belong to the app that reads them, not to the chain
package. `apps/mcp` names them and `.env.example` documents them as vault-only.

**Why.** Two existing rules pointed in opposite directions and the cutover ran into the
gap between them.

`HederaChainAdapterConfig` is stated in SDK types: a `Client`, an `AccountId`, and two
`PrivateKey`s. That is the right shape for the package that owns the chain. But
`CLAUDE.md`'s repo layout says **nothing else in the repo imports the Hedera SDK
directly**, and `apps/mcp` therefore cannot construct any of those three values. The
adapter could not be composed from outside its own package without breaking a hard
layout rule.

The other half was already reasoned out and stays. `packages/chain/src/config.ts`
declined to name the platform keys, in its own words, rather than "inventing new
required env-var names into a shared `.env.example` unilaterally" — those keys are the
vault-only shared-infra keys, and their names are a deployment concern rather than a
chain concern. So the factory takes values, never variable names, and the naming lands
in the composition root that already owns `X402_*` and the other `HANDOFF_*` variables.

The alternative — importing `@hiero-ledger/sdk` into `apps/mcp` just to call
`AccountId.fromString` — was rejected. It breaks the layout rule for a parsing
convenience, and the layout rule is what keeps the schema package the cutover seam.

**Consequences.**

- `packages/chain/src/compose.ts` is new and is the supported way to build the adapter
  from configuration. `HederaChainAdapter`'s constructor stays as it is for callers
  inside the package and for a process that genuinely holds its own keys.
- `resolveClaimantKey` is deliberately **not** settable through the factory. A claim is
  published from the claimant's own account, and a server-side composition root has no
  business holding an expert's key; the adapter refuses the publish instead of signing
  as itself. A process that really is the claimant constructs the class directly and
  says so out loud.
- `packages/chain` and `packages/content` gained `main`, `types` and `exports`. Neither
  had them, because until the cutover nothing imported either package across a workspace
  boundary.
- `.env.example` gains five variables. Two of them, `HANDOFF_VERIFIER_KEY` and
  `HANDOFF_SCHEDULE_ADMIN_KEY`, are vault-only and marked as such. They never enter a
  workspace with a browser build.
- **Khishgee owns the values, not the names.** The escrow account id and both keys come
  from the shared escrow provisioned out of band under
  `2026-09-07-one-shared-escrow-account-this-week.md`. Until they exist,
  `HANDOFF_CHAIN=testnet` refuses to start rather than running on a mock.
- No hard rule, tier or lifecycle changes, so the brief and `docs/architecture.md` are
  unaffected.
