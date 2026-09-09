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
import type { CertTagOption } from "./config.js";
import { readOrderStatus } from "./status.js";
import { unknownTagReply } from "./replies.js";

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
  readonly attestationsTopicId: string;
  readonly certTags: readonly CertTagOption[];
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
  /**
   * Whose account funds the escrow.
   *
   * A claim, not a credential. Anyone can put anyone's account id here, so it
   * is checked below against the account the facilitator says actually paid,
   * and only the verified one is ever used. It has to be in the body rather
   * than in the server's configuration because a service reachable by more
   * than one requester cannot know the caller from an environment variable.
   */
  requester_account_id: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, "expected a Hedera account id like 0.0.1234"),
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
  // Deliberately free and deliberately not a payment surface. It says the
  // process is up, nothing about the chain or the facilitator, so it cannot
  // become a way to read anything the gate is supposed to charge for.
  if (request.path === "/health") {
    return { status: 200, headers: json, body: { status: "ok", network: deps.gateConfig.network } };
  }

  // Free, like /health and for the same reason as every other read: the gate
  // covers order posting only, and this list is what an agent needs before it
  // can post a routable order at all.
  if (request.path === "/tags") {
    if (request.method !== "GET") {
      return { status: 405, headers: { ...json, Allow: "GET" }, body: { error: "use GET" } };
    }
    return { status: 200, headers: json, body: { tags: deps.certTags } };
  }

  // Reads are ungated by decision. Everything returned here is already on a
  // public topic that any mirror node serves without asking us, so there is
  // nothing to charge for and nothing private to leak.
  const orderRead = /^\/orders\/([^/]+)$/.exec(request.path);
  if (orderRead !== null) {
    if (request.method !== "GET") {
      return { status: 405, headers: { ...json, Allow: "GET" }, body: { error: "use GET" } };
    }
    let orderId: string;
    try {
      orderId = decodeURIComponent(orderRead[1] ?? "");
    } catch {
      // `decodeURIComponent("%")` throws. This route is unauthenticated, so a
      // malformed id is an ordinary answer rather than something to raise.
      return { status: 400, headers: json, body: { error: "that is not a usable order id" } };
    }

    const status = await readOrderStatus(orderId, {
      chain: deps.chain,
      ordersTopicId: deps.ordersTopicId,
      attestationsTopicId: deps.attestationsTopicId,
    });
    return { status: 200, headers: json, body: status };
  }

  if (request.path !== "/orders") {
    return { status: 404, headers: json, body: { error: "not found" } };
  }
  if (request.method !== "POST") {
    return { status: 405, headers: { ...json, Allow: "POST" }, body: { error: "use POST" } };
  }

  const gateDeps = { facilitator: deps.facilitator, config: deps.gateConfig };

  let outcome;
  try {
    outcome = await gate(headerLookup(request.headers), "/orders", gateDeps);
  } catch (error) {
    // We settle through a facilitator we do not run, so its outage is a
    // failure mode we own the presentation of. An unpriced 503 is honest:
    // we cannot state a price we cannot have co-signed.
    return {
      status: 503,
      headers: { ...json, "Retry-After": "30" },
      body: { error: "the payment facilitator is unreachable", detail: (error as Error).message },
    };
  }

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

  // The tag is the routing, so an unknown one is refused here — after verify,
  // before settle, before anything is published. Nothing has been charged at
  // this point and the reply says so.
  if (!deps.certTags.some((tag) => tag.code === parsed.data.cert_tag)) {
    return {
      status: 400,
      headers: json,
      body: {
        error: "unknown credential tag",
        message: unknownTagReply(parsed.data.cert_tag, deps.certTags),
        available: deps.certTags,
      },
    };
  }

  // Who pays is settled by the facilitator, never by the caller's own say-so.
  // Same slot as the tag check: after verify, before settle, before anything
  // is published, so a refusal here has taken nothing.
  if (outcome.payer === undefined) {
    return {
      status: 502,
      headers: json,
      body: {
        error: "the facilitator verified the payment but did not say who paid",
        message:
          "The payment checked out, but the facilitator did not name the account it came " +
          "from, and the escrow cannot be funded by an account nobody has vouched for. " +
          "Nothing was charged.",
      },
    };
  }
  if (outcome.payer !== parsed.data.requester_account_id) {
    return {
      status: 400,
      headers: json,
      body: {
        error: "the order names a different requester than the one who paid",
        message:
          `The order says ${parsed.data.requester_account_id} is the requester, but the ` +
          `service fee was paid from ${outcome.payer}. An order is funded by the account ` +
          `that paid for it. Nothing was charged.`,
      },
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
        // The verified account, not the one the body claimed. They are equal
        // by the check above; reading it from the payment keeps that obvious.
        requesterAccountId: outcome.payer,
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

  // Past this point the envelope is published and the funds are locked, so
  // there is no failure worth hiding the order behind. A settlement that
  // throws is reported the same way as one that comes back unsuccessful: the
  // caller gets their order id either way, and we say the fee did not land.
  let settled: Awaited<ReturnType<typeof settle>> | undefined;
  let settleError: string | undefined;
  try {
    settled = await settle(outcome, gateDeps);
  } catch (error) {
    settleError = (error as Error).message;
  }

  const feeFailure = settleError ?? (settled?.receipt.success === false
    ? settled.receipt.errorReason ?? settled.receipt.errorMessage ?? "settlement failed"
    : undefined);

  return {
    status: 200,
    headers: { ...json, ...(settled?.headers ?? {}) },
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
        service_fee: settled?.receipt.transaction ?? "",
      },
      service_fee: {
        settled: feeFailure === undefined,
        // What we charged, stated by the side that set the price. The caller
        // saw it in the 402, but the reply should not make them go back for it.
        amount_tinybars: deps.gateConfig.feeTinybars,
        payer: outcome.payer ?? settled?.receipt.payer,
        ...(feeFailure === undefined ? {} : { error: feeFailure }),
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
