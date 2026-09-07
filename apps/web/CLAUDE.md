# apps/web — the expert app

**Owner: P3 Jack.** This app is on camera for most of the demo, so it is a product
surface before it is a codebase.

## What this app owns

- Inbox, review workspace, verdict editor, sign action.
- The `defects[]` editor, enforcing the bounds from `@handoff/schema` in the UI so an
  expert never writes something the verifier will reject.
- The lost-claim-race experience.

## What this app must never do

- **Never hold a platform key.** The verifier key and the schedule-admin key are
  server-side only. This is a browser build and its tsconfig deliberately has no Node
  types.
- **Never invent a bound.** Import `DEFECTS_MAX_ITEMS` and `DEFECT_CODE_MAX_BYTES` from
  the schema package so the UI and the verifier agree by construction.
- **Never send the expert's written notes on-chain.** They go to the content store and
  only `notes_hash` is published.
- **Never treat an optimistic claim as settled.** Consensus timestamp decides who won.
  Render optimistically if you like, but handle losing the race when the mirror node
  confirms an earlier claim, and make losing feel like an ordinary outcome rather than
  an error.

## Two timings that shape the UI

- The mirror node lags. Hedera's own tutorial waits six seconds after a submit. Design
  for that rather than spinning forever.
- Hashscan is a viewer, not a dependency. Read mirror nodes directly and treat the
  Hashscan link as garnish; its indexing can lag past the length of the demo.

Stack is React, Tailwind and shadcn/ui. Screens get sketched as throwaway HTML
artifacts, not in a design tool. The review workspace is the one worth mocking carefully.

## Who signs, and how the key gets here

- The account and, on testnet, the private key come from the **connect screen**, not
  the environment. `VITE_EXPERT_ACCOUNT_ID` is an optional prefill and nothing more.
- The key is pasted into a masked field that no password manager treats as a credential
  (a password field where the masking CSS is missing), wrapped in `SecretKey`
  (`src/session/secret.ts`), read exactly once by `createWebChain`, and handed to the
  adapter as a plain string. The holder never enters React state, `localStorage`, an
  error message, or a log. `scrubHex` redacts anything the adapter says back on the
  connect path. The adapter P1 returns must keep the key the same way: in a closure or
  a WeakMap, never as an own property, because the adapter itself does sit in state.
- Mock mode has no key field. The mock signs nothing, and the mock member of
  `ExpertConnection` has no key slot, so a key in mock mode cannot be constructed.
- `ExpertChain` is the slice of `ChainAdapter` the sign path may call: no
  `signSchedule`, `createSchedule`, `deleteSchedule`, `lockFunds`. Only the mock
  member of `WebChain` carries the whole adapter, under `mock`, for the stand-ins.
- Before the key is typed, the app reads `GET /api/v1/accounts/{id}` on the **testnet**
  mirror node to confirm the account and its curve. Never in mock mode.
- `vite build` and `vite dev` refuse a `VITE_` variable whose name says secret or whose
  value is shaped like a private key, before any bundle exists (`vite.config.ts`,
  `src/chain/secretNames.ts`). The runtime check in `config.ts` is the second line.
