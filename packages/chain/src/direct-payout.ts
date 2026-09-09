/**
 * The direct co-signed payout — replaces ScheduleCreate/ScheduleSign for a
 * KeyList-controlled escrow (see pending-payout.ts and
 * docs/decisions/2026-09-08-direct-cosigned-payout-replaces-schedulecreate.md).
 *
 * Both platform keys sign the SAME TransferTransaction in one call, verified against
 * real testnet (docs/research/schedule-create-keylist-blocker.md, diagnostic 5 — a
 * plain co-signed transfer debiting a KeyList account succeeds; it's specifically
 * ScheduleCreateTransaction that doesn't).
 */
import { type AccountId, type Client, Hbar, type PrivateKey, TransferTransaction } from "@hiero-ledger/sdk";
import { assertPositive, formatTinybars, parseTinybars } from "@handoff/schema";
import type { TxResult } from "./escrow.js";

export interface DirectPayoutParams {
  escrowAccountId: AccountId;
  payeeAccountId: AccountId;
  amountTinybars: string;
  verifierKey: PrivateKey;
  scheduleAdminKey: PrivateKey;
}

export async function executeDirectPayout(client: Client, params: DirectPayoutParams): Promise<TxResult<Record<string, never>>> {
  const amount = Hbar.fromTinybars(formatTinybars(assertPositive(parseTinybars(params.amountTinybars))));

  const transfer = new TransferTransaction()
    .addHbarTransfer(params.escrowAccountId, amount.negated())
    .addHbarTransfer(params.payeeAccountId, amount);

  const frozen = await transfer.freezeWith(client).sign(params.verifierKey);
  const doubleSigned = await frozen.sign(params.scheduleAdminKey);
  const response = await doubleSigned.execute(client);
  await response.getReceipt(client);

  return { transactionId: response.transactionId.toString(), result: {} };
}
