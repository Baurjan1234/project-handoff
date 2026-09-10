/**
 * "My requests", read off the chain rather than taken on trust.
 *
 * The order envelope has no requester field — it is a `strictObject` in
 * `@handoff/schema` and adding one is a change to the treaty — so the orders
 * topic cannot answer "which of these are mine". Asking a server to answer it
 * would be taking its word for it.
 *
 * The money answers it instead. Since
 * `docs/decisions/2026-09-08-requester-signs-the-fund-lock.md` the escrow is
 * funded by **the requester's own signed transfer**, and that transfer is
 * memoed with the order id. So a request is mine exactly when my account paid
 * the escrow for it, which is a plain mirror-node read of my own transfers:
 *
 *     GET /transactions?account.id={me}&transactiontype=CRYPTOTRANSFER&result=success
 *
 * Verified against the real testnet run recorded in the brief. One fund lock
 * has three legs, and the shape matters:
 *
 *     { account: "0.0.802",       amount:     263325 }   the node fee
 *     { account: "0.0.10376659",  amount: -100263325 }   the requester, value + fee
 *     { account: "0.0.10422187",  amount:  100000000 }   the escrow, the value exactly
 *
 * **The escrow's leg is the order value; the requester's is not.** It carries
 * the transaction fee folded in, so matching on `-value` would find nothing.
 * The value is read off the escrow leg and the requester is only required to
 * have paid something.
 *
 * Nothing here is a float: amounts arrive as JSON numbers, are checked to be
 * exact integers by `tinybarsOf`, and are bigint from then on.
 */

import { tinybarsOf, toSdkTransactionId } from "../sign/payoutLocator";

/** The id shape the resource server mints, as its own schema states it. */
const ORDER_ID = /^ord_[0-9a-f]{32}$/;

/** One order this account paid the escrow for. */
export interface MyRequest {
  readonly orderId: string;
  /** The order value, off the escrow's leg. */
  readonly amountTinybars: bigint;
  /** The fund lock itself, in the SDK's id form, for a Hashscan link. */
  readonly lockTransactionId: string;
  /** When the lock reached consensus. Newest first in the list. */
  readonly lockedAt: string;
}

interface MirrorTransfer {
  readonly account: string | null;
  readonly amount: number;
}

interface MirrorTransaction {
  readonly transaction_id: string;
  readonly consensus_timestamp: string;
  /** Base64, because a memo is bytes. The order id lives here. */
  readonly memo_base64?: string | null;
  readonly transfers?: readonly MirrorTransfer[];
}

export interface MyRequestsParams {
  readonly mirrorNodeUrl: string;
  /** The connected account. Whose requests these are. */
  readonly requesterAccountId: string;
  readonly escrowAccountId: string;
  /** How many transactions to look back over. The mirror caps a page at 100. */
  readonly limit?: number;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

export function myRequestsQueryUrl(params: MyRequestsParams): string {
  const query = new URLSearchParams({
    "account.id": params.requesterAccountId,
    transactiontype: "CRYPTOTRANSFER",
    result: "success",
    order: "desc",
    limit: String(params.limit ?? 50),
  });
  return `${params.mirrorNodeUrl.replace(/\/+$/, "")}/transactions?${query.toString()}`;
}

/**
 * A memo is bytes on the wire. An order id is ASCII, so `atob` is enough, and
 * anything that is not one is not a fund lock we care about.
 */
export function memoOf(transaction: { readonly memo_base64?: string | null }): string {
  const encoded = transaction.memo_base64;
  if (typeof encoded !== "string" || encoded === "") return "";
  try {
    return atob(encoded);
  } catch {
    return "";
  }
}

/**
 * The fund locks in one page of transactions, newest first.
 *
 * Exported apart from the fetch so the matching is testable without a network
 * and without a fake `fetch`.
 */
export function fundLocksIn(
  transactions: readonly MirrorTransaction[],
  requesterAccountId: string,
  escrowAccountId: string,
): readonly MyRequest[] {
  const found: MyRequest[] = [];

  for (const transaction of transactions) {
    const orderId = memoOf(transaction);
    if (!ORDER_ID.test(orderId)) continue;

    // This is the account's whole transfer history, not a curated list, so a
    // transaction here can be anything the account ever did. One it cannot
    // read is skipped rather than thrown: refusing the page would let an
    // unrelated transfer — an amount past what a JSON number holds exactly,
    // an id in a shape we do not know — delete every request from the screen.
    // The amounts that matter are the escrow's, and those are bounded.
    try {
      const transfers = transaction.transfers ?? [];

      // The escrow's leg is the order value, exactly. A credit, so positive.
      const credited = transfers.find((t) => t.account === escrowAccountId && tinybarsOf(t.amount) > 0n);
      if (credited === undefined) continue;

      // And this account paid for it. The amount is value + fee, so only the
      // direction is checked; the value came off the escrow's leg above.
      const paid = transfers.some((t) => t.account === requesterAccountId && tinybarsOf(t.amount) < 0n);
      if (!paid) continue;

      found.push({
        orderId,
        amountTinybars: tinybarsOf(credited.amount),
        lockTransactionId: toSdkTransactionId(transaction.transaction_id),
        lockedAt: transaction.consensus_timestamp,
      });
    } catch {
      continue;
    }
  }

  return found;
}

/** Read this account's fund locks from the mirror node. Newest first. */
export async function readMyRequests(params: MyRequestsParams): Promise<readonly MyRequest[]> {
  const fetchImpl = params.fetchImpl ?? ((input, init) => fetch(input, init));
  const response = await fetchImpl(myRequestsQueryUrl(params), params.signal === undefined ? {} : { signal: params.signal });
  if (!response.ok) throw new Error(`The network answered ${response.status} when reading your requests.`);
  const body = (await response.json()) as { transactions?: readonly MirrorTransaction[] };
  return fundLocksIn(body.transactions ?? [], params.requesterAccountId, params.escrowAccountId);
}
