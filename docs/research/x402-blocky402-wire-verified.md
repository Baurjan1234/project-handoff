# x402 on Hedera: the wire, verified against Blocky402

Verified 2026-09-05 by reading the Blocky402 API reference, the
`hedera-dev/scaffold-hbar` template sources, the npm registry metadata, and by calling
the hosted testnet facilitator directly. Conclusions and gotchas only.

## The scaffold's facilitator is not Blocky402

`facilitator/package.json` on `templates/x402-pay-per-use` names itself
`x402-hedera-facilitator`, "self-hosted x402 facilitator for Hedera, wrapping the
official `@x402/hedera` reference scheme". It is a different program from Blocky402.

They are interchangeable at the protocol level — both speak x402 version 2 with the
`exact` scheme — so the template stays useful as plumbing, but the prize wording is
satisfied only by pointing at the hosted Blocky402 testnet endpoint. Closes NAS-17 and
the open question in `x402-reference-implementations.md`.

## Blocky402 testnet is live and does support Hedera

`GET https://api.testnet.blocky402.com/supported`, measured 2026-09-05:

```json
{"kinds":[
  {"x402Version":2,"scheme":"exact","network":"eip155:80002"},
  {"x402Version":2,"scheme":"exact","network":"solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
   "extra":{"feePayer":"7B6Q2MvcJvNcy1A13wHmAzmmdo3L8DVriaXML7bvkojm"}},
  {"x402Version":2,"scheme":"exact","network":"hedera:testnet",
   "extra":{"feePayer":"0.0.7162784"}}],
 "extensions":[],
 "signers":{"hedera:*":["0.0.7162784"], ...}}
```

`GET /health` returned `{"status":"ok","version":"1.0.0"}`. Testnet needs no
authentication. Mainnet needs an `X-Api-Key` and is "coming soon", which is one more
reason hard rule 5 costs us nothing.

## The library stack, and who publishes it

| Package | Version | Depends on |
|---|---|---|
| `@x402/core` | 2.25.0 | `zod` only. No chain code |
| `@x402/hedera` | 2.25.0 | `@x402/core`, `@hiero-ledger/sdk` 2.85.0, `@hiero-ledger/proto` |

Published by Coinbase, Apache-2.0, from `github.com/coinbase/x402`. Subpath exports are
`./exact/client`, `./exact/server` and `./exact/facilitator`, so the client half and the
resource-server half are separate entry points.

**`@x402/hedera` transitively contains the Hedera SDK** (`@hiero-ledger/sdk` is the
renamed SDK). We never import the SDK ourselves, and the signing we would otherwise have
had to write lives inside `ExactHederaScheme`. This changes what `apps/requester` needs
from `packages/chain` for the fee leg, which is a question for the sync rather than a
finding here.

Node: the template pins Node 20.18.3+; our `.nvmrc` is 24.11.1, which is above the floor.

## The header is not `X-PAYMENT` on the version 2 path

The brief, `CLAUDE.md` and both lane files say the client retries with the base64 payload
in `X-PAYMENT`. That is the x402 version 1 name.

- `@x402/core` version 2 encodes with `encodePaymentSignatureHeader()` and sends
  **`PAYMENT-SIGNATURE`**.
- The template's resource server reads `payment-signature` first and falls back to
  `x-payment`, which it labels legacy.
- Blocky402's `/verify` accepts three input shapes: a canonical `paymentPayload` object,
  an `X-PAYMENT` header, or a legacy base64 `paymentHeader`.

We own both ends of the header, so the practical rule is: **go through `@x402/core` and
never hand-roll the header**, and have our resource server accept both names. Nothing in
the design depends on which one wins, but a document that names only `X-PAYMENT` will
send someone hunting for a bug that is not there.

## The shapes, field for field

**402 response body.** An `accepts` array; the client takes `accepts[0]`.

```json
{"accepts":[{"scheme":"exact","network":"hedera:testnet","amount":"100000",
  "payTo":"0.0.8011510","maxTimeoutSeconds":300,"asset":"0.0.0",
  "extra":{"feePayer":"0.0.7162784"}}]}
```

**Payment payload**, JSON then base64 into the header:

```json
{"x402Version":2,"scheme":"exact","network":"hedera:testnet",
 "accepted":{...the requirements object...},
 "payload":{"transaction":"<base64 TransferTransaction bytes>"}}
```

**`POST /verify` and `POST /settle`** take the same body:
`{"x402Version":2,"paymentPayload":{...},"paymentRequirements":{...}}`.

- `/verify` → `{"isValid":true,"payer":"0.0.x"}`, or
  `{"isValid":false,"invalidReason":"InvalidSignature","invalidMessage":"..."}`.
- `/settle` → `{"success":true,"transaction":"0.0.7162784@1234567.890123456",
  "network":"hedera:testnet","payer":"0.0.x"}`, or `{"success":false,"errorReason":...,
  "errorMessage":...,"transaction":"","network":...}`.

`transaction` on a settle response is the Hedera transaction ID. That is the one to
thread through and to put on screen; it is the only tx ID the fee leg produces.

## Gotchas that will cost an evening

- **`extra.feePayer` must match the facilitator's own signer**, or verification fails.
  Discover it at startup from `/supported` — `kinds.find(k => k.network ===
  "hedera:testnet").extra.feePayer`, falling back to `signers["hedera:*"][0]`. Hard-code
  it and a rotation on their side breaks the demo silently.
- **`asset: "0.0.0"` means HBAR.** A token ID there means a token, and a token means an
  association on both accounts first. This is the same conclusion the brief reached from
  the other direction: pay in HBAR.
- **`amount` is a decimal string in tinybars.** It arrives as a string and stays one;
  conversion goes through the money module.
- **Settlement is asynchronous.** `/verify` is what gates serving the resource;
  `/settle` returns the receipt afterwards. Serving on `/verify` is the design, not a
  shortcut.
