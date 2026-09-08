# P1 signs off on @hiero-ledger/sdk 2.85.0 (down from 2.87.0)

**Decision.** Accept PR #15's workspace-wide `pnpm.overrides` pin of
`@hiero-ledger/sdk` to `2.85.0`, replacing the `2.87.0` `packages/chain` had
pinned directly. This is P1's explicit sign-off, requested in the PR description
because the decision authorizing `@x402/hedera` in `packages/chain` (NAS-35) did
not extend to touching the root manifest.

**Why.** `@x402/hedera` pins `@hiero-ledger/sdk` at exactly `2.85.0`, with its own
manifest noting `@hiero-ledger/proto` must stay in lockstep. Installed alongside a
separate `2.87.0` pin, two copies land side by side; a `PrivateKey` built by one
is a structurally different type from the other. It signs correctly at runtime,
but `tsc` rejects the hand-off, and the same mismatch at runtime is the kind that
surfaces as an opaque `InvalidSignature` from the facilitator rather than
anything readable — exactly the failure mode this project's engineering
agreements exist to avoid.

Verified empirically after merging, not just accepted on the PR's word:
`pnpm install` + `pnpm -r typecheck` + `pnpm -r test` across the whole
workspace — 261 tests, 0 failures, including all 35 in `packages/chain`
unchanged. `node_modules/.pnpm` shows one linked `@hiero-ledger/sdk` build for
every workspace package; a leftover `2.87.0` folder in the pnpm store is
unreferenced by the lockfile and harmless (a `pnpm store prune` would clear it,
not required).

**Consequences.** `packages/chain`'s dependency on `@hiero-ledger/sdk` reads
`2.85.0` going forward; do not re-bump it without checking `@x402/hedera`'s own
pin first, since the two must stay in lockstep. Any future Hedera SDK upgrade
that touches the root `pnpm.overrides` needs the same sign-off this decision
documents — that override affects every package in the workspace, not just this
one.
