# The 402 lives in an HTTP resource server, and the MCP tool pays it

**Decision.** `handoff_verify` is two pieces, both in `apps/mcp`.

1. An **HTTP resource server**, `POST /orders`, with the x402 gate in front of it. This
   is where the 402 is answered, where the facilitator is called, and where the order is
   posted.
2. The **MCP tool**, which is a thin x402-paying client of that endpoint. An agent
   session calls the tool; the tool pays and returns the order.

The server is hand-rolled against the verified Blocky402 bodies rather than built on
`@x402/core`'s resource-server class, and it carries **no Hedera dependency of any kind**.

The sequence is gate, post, settle, in that order.

**Why.** MCP has no 402. The protocol is JSON-RPC over stdio or a streamed transport, and
its clients do not implement HTTP payment semantics — there is no status code for a tool
call to reject with, and no header for one to retry with. Putting the gate at the MCP
layer would mean inventing a private payment handshake, which is the opposite of what the
prize asks for. HTTP is where 402 is defined, so that is where it goes, and the MCP tool
becomes an ordinary client of a paid endpoint.

The server needs nothing from Hedera. It states a price, hands the client's signed
payload to the facilitator, and forwards a receipt. Everything chain-shaped happens
inside Blocky402 or inside `packages/chain`. Building on `x402ResourceServer` would have
required registering `ExactHederaScheme` — verified in the published `@x402/core@2.25.0`
bundle, which throws "No server implementation registered" without one — and that scheme
is what depends on `@hiero-ledger/sdk`. Roughly eighty lines of our own code buys the
workspace out of that dependency entirely.

Settling last is the part worth defending. `/verify` proves a payment is good without
submitting it, so if the order fails to post, the caller still has their money and can
retry. Settling alongside serving would charge for a service that did not happen.

**Consequences.**

- **The SDK-import question is confined to `apps/requester`.** Only the payer signs, and
  only signing needs `@x402/hedera`. `apps/mcp` stays clean under the current rule with
  no exception required. The sync question is about one app, not two.
- **The demo shows the 402 in HTTP terms.** The narration is "the agent calls a paid
  endpoint, gets 402, pays, and the order posts", not anything MCP-specific. The video
  can show the status code, which is more legible to a judge than a tool call would be.
- The facilitator's uptime is a live dependency of the demo. The gate answers 503 with
  `Retry-After` when Blocky402 is unreachable, and a settlement that fails after the
  order posts returns the order anyway with the fee marked unsettled. Both are ordinary
  answers rather than crashes, because the honest admission that we do not run that
  service is only honest if its failure is legible.
- The MCP tool is now a client of our own endpoint, which means the demo can be driven
  either from an agent session or with `curl`. The recording uses the agent; the fallback
  is a shell.
- `POST /orders` sells a `review` and refuses an `execution` order rather than
  downgrading one. The class is what the expert returns, and this build does not sell the
  other one.
