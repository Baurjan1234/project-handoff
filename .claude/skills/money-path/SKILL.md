---
name: money-path
description: Invariants and required tests for code where a bug costs real money. Use when touching tinybars, HBAR, prices, fees, payouts, hashing, canonical serialization, envelope or attestation validation, escrow key composition, HCS size bounds, or anything in packages/schema.
---

# Money-path code

Code that decides what gets paid, what gets hashed, or what counts as valid. A bug here
is not a rendering glitch.

## Invariants

**Money is never a float.** Tinybars as `bigint` internally, strings at every boundary.
`number` does not appear, not for display, not for comparison, not once. If you are
writing `/ 100000000`, `parseFloat`, `Number(`, or `toFixed` on an amount, stop.

**All conversion lives in one module.** `packages/schema/src/money.ts` and nowhere else.
Import from it rather than reimplementing eight decimal places.

**Refuse rather than round.** More precision than a tinybar is an error, not a rounding.
Silently discarding someone's money is worse than refusing their input. Every amount is
bounds-checked against int64, because that is what Hedera accepts.

**Hashing is canonical or it is worthless.** Two implementations must produce identical
bytes from the same logical value. Keys sorted by UTF-16 code unit, no whitespace,
ambiguous values rejected rather than guessed. Fractional numbers are refused on purpose;
that is the compile-time enforcement of money being a string.

**The class rule is a type, not a comment.** `review` carries `artifact_hash_in` and
never `artifact_hash_out`. `execution` carries `artifact_hash_out`, plus `_in` when an
input existed. Model it as a discriminated union of strict objects so the wrong shape is
impossible to construct and impossible to parse. A missing or extra hash is a schema
violation, and a schema violation is the only path that claws money back.

**Bounds live in the schema package and nothing else defines them.** The UI and the
verifier import the same constant, so a value the UI accepts is a value the verifier
accepts.

**No `any`. No `@ts-ignore`.** Anywhere near money, verdicts, hashing or key composition.
`@ts-expect-error` is allowed in a test that asserts a wrong shape fails to typecheck.

## Required tests

Do not consider money-path work done without these:

- Round trips in both directions, including the smallest and largest representable value.
- The inputs a lenient parser would wave through: exponent notation, thousands
  separators, leading zeros, whitespace, a bare decimal point, a number where a string
  was promised.
- Boundary conditions at the exact limit and one past it, on both sides.
- For hashing: identical output regardless of key insertion order, and different output
  when any value changes.
- For anything bounded by HCS: build the **worst case with every field at its maximum**
  and assert it still fits in one message. That test fails if someone widens a bound
  without checking, which is the point.

## When you change a shape

`packages/schema` is the treaty between four people. A change to it is a pull request
tagged `breaking`, announced at the sync. Every envelope and attestation carries
`schema_version`; bumping it means adding a member to a version union, never replacing
the literal, because old versions must stay parsable. Design additively.
