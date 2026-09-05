/**
 * The resource server: `POST /orders`, behind the payment gate.
 *
 * The sequence, and the order is the design:
 *
 * 1. Gate. No payment, or a payment the facilitator rejects, is answered with
 *    402 and the price. Nothing else happens.
 * 2. Post. The order envelope publishes and the funds lock.
 * 3. Settle. Only now does the fee actually move, and its receipt rides back
 *    in the `PAYMENT-RESPONSE` header.
 *
 * Settling last is deliberate. `/verify` proves the payment is good without
 * submitting it, so a failure to post the order leaves the caller's money
 * untouched — they were charged for a service they did not receive only if we
 * settle first, and we do not.
 */

import * as z from "zod";
import { hbarToTinybars, Utc, type ChainAdapter } from "@handoff/schema";
import type { ContentStore } from "./content.js";
import { postReviewOrder } from "./order.js";
import { gate, headerLookup, settle, type GateConfig } from "./x402/gate.js";
import type { Facilitator } from "./x402/facilitator.js";

export interface HttpRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface ServerDeps {
  readonly facilitator: Facilitator;
  readonly gateConfig: GateConfig;
  readonly chain: ChainAdapter;
  readonly content: ContentStore;
  readonly ordersTopicId: string;
  readonly requesterAccountId: string;
}

/**
 * The request body of `handoff_verify`.
 *
 * `class` is accepted and pinned rather than ignored: an agent that asks for
 * an `execution` order gets told this build does not sell one, instead of
 * quietly receiving a review.
 */
const OrderRequestBody = z.strictObject({
  class: z.literal("review").default("review"),
  spec: z.string().min(1),
  /** Base64, because JSON has no bytes. Never published, only hashed. */
  artifact_base64: z.string().min(1),
  cert_tag: z.string().min(1),
  /**
   * Delegated to the money module rather than re-expressed as a regex here.
   * A bound that exists in two places is a bound that will disagree with
   * itself, and this one decides how much money is at stake.
   */
  price_hbar: z.string().refine(
    (value) => {
      try {
        hbarToTinybars(value);
        return true;
      } catch {
        return false;
      }
    },
    { message: "not an HBAR amount, for example 200 or 0.5" },
  ),
  deadline: Utc,
  claim_timeout_seconds: z.int().positive(),
});

const json = { "Content-Type": "application/json" } as const;

export async function handle(request: HttpRequest, deps: ServerDeps): Promise<HttpResponse> {
  if (request.path !== "/orders") {
    return { status: 404, headers: json, body: { error: "not found" } };
  }
  if (request.method !== "POST") {
    return { status: 405, headers: { ...json, Allow: "POST" }, body: { error: "use POST" } };
  }

  const gateDeps = { facilitator: deps.facilitator, config: deps.gateConfig };
  const outcome = await gate(headerLookup(request.headers), "/orders", gateDeps);

  if (outcome.kind === "payment-required") {
    return { status: outcome.status, headers: outcome.headers, body: outcome.body };
  }

  const parsed = OrderRequestBody.safeParse(parseJson(request.body));
  if (!parsed.success) {
    // Paid but unusable. We have not settled, so nothing was taken.
    return {
      status: 400,
      headers: json,
      body: { error: "invalid order", detail: z.treeifyError(parsed.error) },
    };
  }

  let posted;
  try {
    posted = await postReviewOrder(
      {
        spec: parsed.data.spec,
        artifact: Buffer.from(parsed.data.artifact_base64, "base64"),
        certTag: parsed.data.cert_tag,
        priceHbar: parsed.data.price_hbar,
        deadline: parsed.data.deadline,
        claimTimeoutSeconds: parsed.data.claim_timeout_seconds,
      },
      {
        chain: deps.chain,
        content: deps.content,
        ordersTopicId: deps.ordersTopicId,
        requesterAccountId: deps.requesterAccountId,
      },
    );
  } catch (error) {
    // Do not settle. The payment is verified but unsubmitted, so the caller
    // still has their money and can retry. Swallowing this into a settled fee
    // would charge for a service that did not happen.
    return {
      status: 502,
      headers: json,
      body: { error: "the order did not post", detail: (error as Error).message },
    };
  }

  const settled = await settle(outcome, gateDeps);

  return {
    status: 200,
    headers: { ...json, ...settled.headers },
    body: {
      order_id: posted.orderId,
      escrow_account_id: posted.escrowAccountId,
      consensus_timestamp: posted.consensusTimestamp,
      sequence_number: posted.sequenceNumber,
      // Threaded, never swallowed. Settlement state is read from a mirror
      // node; these are how you find it.
      transaction_ids: {
        lock_funds: posted.transactionIds.lockFunds,
        submit_envelope: posted.transactionIds.submitEnvelope,
        service_fee: settled.receipt.transaction,
      },
      service_fee: {
        settled: settled.receipt.success,
        payer: outcome.payer ?? settled.receipt.payer,
        ...(settled.receipt.success
          ? {}
          : { error: settled.receipt.errorReason ?? settled.receipt.errorMessage }),
      },
    },
  };
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}
