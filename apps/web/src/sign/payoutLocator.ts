/**
 * Where the payout's transaction id comes from on testnet.
 *
 * The platform pays the expert with one directly co-signed transfer out of
 * the escrow (decision 2026-09-08). The expert app never triggers it and is
 * never told its id, so it finds it the way anyone could: a mirror-node read
 * of the expert's own transfers since the verdict was published, looking for
 * the one that moves exactly the order value from the escrow to the expert.
 * Bounded by the sign time so a payout from an earlier take, on a recording
 * day where the value circulates between takes, can never be mistaken for
 * this one.
 *
 * Query parameters and the response shape are from the mirror node's
 * published API reference for `GET /api/v1/transactions`. Amounts are
 * compared as bigint against the envelope's tinybars; nothing here is a
 * float.
 */

import { parseTinybars } from "@handoff/schema";
import type { PayoutLocator } from "./settlement";

export interface MirrorPayoutParams {
  readonly mirrorNodeUrl: string;
  readonly expertAccountId: string;
  readonly escrowAccountId: string;
  /** The order value, as the envelope states it. */
  readonly amountTinybars: string;
  /** The verdict's consensus timestamp. Nothing before it can be this payout. */
  readonly notBefore: string;
  readonly fetchImpl?: typeof fetch;
}

interface MirrorTransfer {
  readonly account: string | null;
  readonly amount: number;
}

interface MirrorTransaction {
  readonly transaction_id: string;
  readonly consensus_timestamp: string;
  readonly result: string;
  readonly transfers?: readonly MirrorTransfer[];
}

/** The mirror node prints `0.0.x-sec-nanos`; the adapter's reads want the SDK's `0.0.x@sec.nanos`. */
export function toSdkTransactionId(mirrorTransactionId: string): string {
  const match = /^(\d+\.\d+\.\d+)-(\d+)-(\d+)$/.exec(mirrorTransactionId);
  if (match === null) throw new Error(`Not a mirror-node transaction id: ${mirrorTransactionId}`);
  return `${match[1]}@${match[2]}.${match[3]}`;
}

export function payoutQueryUrl(params: MirrorPayoutParams): string {
  const query = new URLSearchParams({
    "account.id": params.expertAccountId,
    timestamp: `gte:${params.notBefore}`,
    transactiontype: "CRYPTOTRANSFER",
    result: "success",
    order: "asc",
    limit: "50",
  });
  return `${params.mirrorNodeUrl.replace(/\/+$/, "")}/transactions?${query.toString()}`;
}

export function mirrorPayoutLocator(params: MirrorPayoutParams): PayoutLocator {
  const amount = parseTinybars(params.amountTinybars);
  const fetchImpl = params.fetchImpl ?? ((input, init) => fetch(input, init));
  const url = payoutQueryUrl(params);

  return {
    async locate() {
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`Mirror node answered ${response.status} for the payout read.`);
      const body = (await response.json()) as { transactions?: readonly MirrorTransaction[] };
      const hit = (body.transactions ?? []).find((tx) => {
        const transfers = tx.transfers ?? [];
        const paidExpert = transfers.some((t) => t.account === params.expertAccountId && BigInt(t.amount) === amount);
        const fromEscrow = transfers.some((t) => t.account === params.escrowAccountId && BigInt(t.amount) === -amount);
        return paidExpert && fromEscrow;
      });
      return hit === undefined ? null : toSdkTransactionId(hit.transaction_id);
    },
  };
}
