/**
 * The `handoff_verify` MCP server.
 *
 * This is the surface a requester agent orders from, in any session. It holds
 * no keys and talks to no chain: it calls the gated HTTP endpoint and pays,
 * exactly as any other customer would.
 *
 * Nothing here may write to stdout. That stream is the JSON-RPC channel, and a
 * stray `console.log` corrupts the protocol. Diagnostics go to stderr.
 */

import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { postOrder, type PaymentSigner } from "./client.js";

export interface McpDeps {
  /** Where the gated resource server is listening. */
  readonly baseUrl: string;
  readonly signer: PaymentSigner;
}

const inputSchema = z.object({
  spec: z
    .string()
    .min(1)
    .describe("What the expert is being asked to judge. Stored, hashed, never published."),
  artifact: z
    .string()
    .min(1)
    .describe("The work to be reviewed. Stored and hashed; only its hash goes on-chain."),
  cert_tag: z.string().min(1).describe("Which certification may claim this order, e.g. cpa-us."),
  price_hbar: z
    .string()
    .min(1)
    .describe("What the judgment is worth, in HBAR, as a string. Held in escrow, not the fee."),
  deadline: z
    .string()
    .min(1)
    .describe("UTC instant, second precision, Z only: 2026-09-14T00:00:00Z."),
  claim_timeout_seconds: z
    .int()
    .positive()
    .describe("How long a claimant has before the order reopens. Short next to the deadline."),
});

export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: "handoff", version: "0.1.0" });

  server.registerTool(
    "handoff_verify",
    {
      description:
        "Order a signed review of a piece of work from a certified human. Funds lock up " +
        "front and the expert's attestation is published on Hedera. Calling this costs a " +
        "small service fee over x402, separately from the price of the judgment itself.",
      inputSchema,
    },
    async (input) => {
      try {
        const posted = await postOrder(
          {
            spec: input.spec,
            artifact: input.artifact,
            certTag: input.cert_tag,
            priceHbar: input.price_hbar,
            deadline: input.deadline,
            claimTimeoutSeconds: input.claim_timeout_seconds,
          },
          { baseUrl: deps.baseUrl, signer: deps.signer },
        );

        return { content: [{ type: "text", text: JSON.stringify(posted, null, 2) }] };
      } catch (error) {
        // An unpayable or rejected order is an answer the agent can act on,
        // so it comes back as text rather than as a transport error.
        return {
          isError: true,
          content: [{ type: "text", text: (error as Error).message }],
        };
      }
    },
  );

  return server;
}
