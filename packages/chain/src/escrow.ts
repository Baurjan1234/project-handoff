import { AccountCreateTransaction, type AccountId, Hbar, type KeyList, type Client } from "@hiero-ledger/sdk";
import { assertPositive, formatTinybars, hbarToTinybars } from "@handoff/schema";

/** Every exported function surfaces its transaction ID — never swallow it (CLAUDE.md). */
export interface TxResult<T> {
  transactionId: string;
  result: T;
}

/**
 * Creates the escrow account for one order, keyed by the 2-of-3 threshold KeyList
 * from keys.ts. `initialBalanceHbar` covers the account's own existence + auto-renew
 * buffer — the order's price is locked separately, by the requester's own
 * signature, in fund-lock.ts.
 */
export async function createEscrowAccount(
  client: Client,
  keyList: KeyList,
  initialBalanceHbar: string,
): Promise<TxResult<{ accountId: AccountId }>> {
  const initialBalance = formatTinybars(assertPositive(hbarToTinybars(initialBalanceHbar)));

  const response = await new AccountCreateTransaction()
    .setKey(keyList)
    .setInitialBalance(Hbar.fromTinybars(initialBalance))
    .execute(client);

  const receipt = await response.getReceipt(client);
  if (!receipt.accountId) {
    throw new Error(`AccountCreateTransaction returned no accountId (tx ${response.transactionId.toString()})`);
  }

  return { transactionId: response.transactionId.toString(), result: { accountId: receipt.accountId } };
}

