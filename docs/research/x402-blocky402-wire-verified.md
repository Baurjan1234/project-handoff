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

## The headers are not what our documents say

Read out of the published `@x402/core@2.25.0` bundle, not inferred. Version 2 carries the
whole exchange in headers and keeps the version 1 names as compatibility.

| Direction | Version 2 | Version 1 |
|---|---|---|
| Server states the price on the 402 | `PAYMENT-REQUIRED` header, plus `Cache-Control` | body only |
| Client pays on the retry | `PAYMENT-SIGNATURE` | `X-PAYMENT` |
| Server returns the settlement receipt | `PAYMENT-RESPONSE` | `X-PAYMENT-RESPONSE` |

`encodePaymentSignatureHeader()` switches on `x402Version` and emits `PAYMENT-SIGNATURE`
for 2, `X-PAYMENT` for 1, with the same encoder behind both.

Three consequences that are easy to get wrong:

- **The server's own extractor reads `payment-signature` only.** It does not fall back to
  `x-payment`. The template's Next.js route adds that fallback itself. If we want a
  version 1 client to work against us, that is our code to write, and this week nothing
  needs it.
- **The 402 challenge is a header first.** `getPaymentRequiredResponse(getHeader, body)`
  prefers the `PAYMENT-REQUIRED` header and falls back to the body for version 1
  compatibility. The `accepts` array in the body is the compatibility path, not the
  canonical one.
- **The settlement receipt reaches the client as `PAYMENT-RESPONSE`.** That is where the
  fee leg's transaction ID arrives on the requester side, and it is what we thread
  through and put on screen. Do not go looking for it in the response body.

The brief, `CLAUDE.md` and both lane files describe step 3 as "retries with the base64
payload in `X-PAYMENT`". That is the version 1 name. Nothing in the design changes — go
through `@x402/core` and never hand-roll a header — but a document that names only
`X-PAYMENT` sends someone hunting for a bug that is not there.

Blocky402 sits behind all of this: its `/verify` accepts a canonical `paymentPayload`
object, an `X-PAYMENT` header, or a legacy base64 `paymentHeader`. We send the canonical
object, so the header question never reaches it.

## The shapes, field for field

**402 response body**, which is the version 1 compatibility path — version 2 puts the
same content in the `PAYMENT-REQUIRED` header. An `accepts` array; the client takes
`accepts[0]`.

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
thread through and to put on screen; it is the only tx ID the fee leg produces. Our
resource server gets it from the facilitator and passes it on in the `PAYMENT-RESPONSE`
header, which is where the requester side reads it.

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
