/**
 * Reading an order's state back off the public topics.
 *
 * MCP is request/response and nothing pushes, so a requester who closed the
 * laptop after posting has no way to learn what happened. Without a query the
 * flow ends at beat 3 for a real user, however well the rest of it works. See
 * `../../../docs/decisions/2026-09-06-ux-fixes-from-persona-and-laws.md`.
 *
 * **This is a query, not a polling loop.** It answers once, from the mirror
 * node, and nothing here retries or waits.
 *
 * **Free, and it has to stay free of anything private.** Reads are ungated by
 * `../../../docs/decisions/2026-09-05-gate-covers-order-posting-only.md`, whose
 * standing consequence is that nothing on a read path may return anything the
 * HCS topics do not already make public. Everything below comes off a topic any
 * mirror node will serve to anybody. The spec and the artifact are in the
 * content store and are not read here.
 */

import * as z from "zod";
import {
  Attestation as AttestationSchema,
  decodeAttestation,
  decodeEnvelope,
  OrderEnvelope as OrderEnvelopeSchema,
  Verdict as VerdictSchema,
  type ChainAdapter,
} from "@handoff/schema";

/**
 * What we can prove about an order from the topics alone.
 *
 * `CLAIMED` is deliberately absent. There is a `CLAIM` event in the lifecycle
 * state machine, but no on-wire claim message exists yet — not in
 * `@handoff/schema`, not as a topic convention — so an honest reader cannot
 * report it. `claimReadable: false` says so out loud rather than letting a
 * requester read "Posted" and conclude nobody has picked it up.
 */
export type ReadableOrderState = "POSTED" | "DELIVERED" | "UNKNOWN";

/**
 * What a status read answers, as a parser first and a type second.
 *
 * One declaration, not two. The MCP tool reads this back over HTTP and puts
 * the verdict straight in front of a requester, so the body is parsed rather
 * than asserted — a cast would make a malformed or hostile response
 * indistinguishable from a real one at exactly the point where the words carry
 * the most weight.
 */
export const OrderStatusShape = z.object({
  orderId: z.string().min(1),
  state: z.enum(["POSTED", "DELIVERED", "UNKNOWN"]),
  envelope: OrderEnvelopeSchema.optional(),
  /** The consensus timestamp the envelope landed at. Ordering truth. */
  postedAt: z.string().optional(),
  attestation: AttestationSchema.optional(),
  verdict: VerdictSchema.optional(),
  /**
   * The account that paid to submit the attestation.
   *
   * That is all this is. It is not proof the account holds the credential:
   * the attestations topic carries no submit key on purpose, and the registry
   * that would check one is not live. Copy built from this must not call the
   * signer certified.
   */
  signedBy: z.string().optional(),
  signedAt: z.string().optional(),
  /**
   * False until a claim message shape exists. When false, a caller must not
   * present "nobody has claimed this" — only "we cannot see claims yet".
   */
  claimReadable: z.boolean(),
});

export type OrderStatus = z.infer<typeof OrderStatusShape>;

export interface StatusDeps {
  readonly chain: ChainAdapter;
  readonly ordersTopicId: string;
  readonly attestationsTopicId: string;
  /** Pages read per topic, as a stop rather than a tuning knob. */
  readonly maxPages?: number;
  readonly pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 25;
const DEFAULT_MAX_PAGES = 40;

/**
 * Walk a topic and hand every message to a reader.
 *
 * Paged on purpose. A mirror node returns 25 by default and paginates through
 * `links.next`, so a reader that takes the first page silently stops seeing
 * orders once a topic has more than a page of them — and it stops seeing the
 * newest ones, which are exactly the ones anybody is asking about.
 */
async function scanTopic<T>(
  topicId: string,
  deps: StatusDeps,
  read: (contents: string, consensusTimestamp: string, payerAccountId: string) => T | undefined,
): Promise<T | undefined> {
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = deps.maxPages ?? DEFAULT_MAX_PAGES;

  let afterSequenceNumber: number | undefined;
  let found: T | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const messages = await deps.chain.readMessages(topicId, {
      limit: pageSize,
      ...(afterSequenceNumber === undefined ? {} : { afterSequenceNumber }),
    });

    if (messages.length === 0) {
      return found;
    }

    for (const message of messages) {
      // A topic with no submit key takes anything anybody submits, so a
      // message that does not parse is ordinary noise, not an error worth
      // failing a status query over.
      let candidate: T | undefined;
      try {
        candidate = read(message.contents, message.consensusTimestamp, message.payerAccountId);
      } catch {
        continue;
      }
      // Keep the last match rather than the first. A later attestation for the
      // same order supersedes an earlier one, and consensus order is the truth.
      if (candidate !== undefined) {
        found = candidate;
      }
    }

    const last = messages[messages.length - 1];
    if (last === undefined || messages.length < pageSize) {
      return found;
    }
    afterSequenceNumber = last.sequenceNumber;
  }

  return found;
}

/** Read what the topics say about one order. */
export async function readOrderStatus(
  orderId: string,
  deps: StatusDeps,
): Promise<OrderStatus> {
  const posted = await scanTopic(deps.ordersTopicId, deps, (contents, consensusTimestamp) => {
    const envelope = decodeEnvelope(contents);
    return envelope.order_id === orderId ? { envelope, consensusTimestamp } : undefined;
  });

  const delivered = await scanTopic(
    deps.attestationsTopicId,
    deps,
    (contents, consensusTimestamp, payerAccountId) => {
      const attestation = decodeAttestation(contents);
      return attestation.order_id === orderId
        ? { attestation, consensusTimestamp, payerAccountId }
        : undefined;
    },
  );

  if (delivered !== undefined) {
    return {
      orderId,
      state: "DELIVERED",
      claimReadable: false,
      ...(posted === undefined
        ? {}
        : { envelope: posted.envelope, postedAt: posted.consensusTimestamp }),
      attestation: delivered.attestation,
      verdict: delivered.attestation.verdict,
      signedBy: delivered.payerAccountId,
      signedAt: delivered.consensusTimestamp,
    };
  }

  if (posted !== undefined) {
    return {
      orderId,
      state: "POSTED",
      claimReadable: false,
      envelope: posted.envelope,
      postedAt: posted.consensusTimestamp,
    };
  }

  // Not a 404. The order may be seconds old and the mirror node lags about six
  // seconds behind consensus, so "we cannot see it" is the honest answer and
  // "it does not exist" is a guess.
  return { orderId, state: "UNKNOWN", claimReadable: false };
}
