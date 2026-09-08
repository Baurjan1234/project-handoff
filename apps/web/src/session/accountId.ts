/**
 * The account id the expert signs from, as typed on the connect screen.
 *
 * Shape only. Whether the account exists on testnet is the mirror node's to
 * say (`mirrorAccount.ts`). The two targeted rejections catch the mistakes a
 * person new to Hedera actually makes: pasting the EVM address the portal
 * also shows, and pasting the key into the id box. Neither message repeats
 * what was typed.
 */

export const ACCOUNT_ID = /^0\.0\.[1-9]\d*$/;

export type AccountIdCheck =
  | { readonly ok: true; readonly accountId: string }
  | { readonly ok: false; readonly reason: string };

export function parseAccountId(text: string): AccountIdCheck {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, reason: "Enter your account id, like 0.0.12345." };
  if (/^0x[0-9a-f]{40}$/i.test(trimmed)) {
    return { ok: false, reason: "That is an EVM address. Enter the account id from the portal, like 0.0.12345." };
  }
  if (/^(0x)?[0-9a-f]{64,}$/i.test(trimmed)) {
    return { ok: false, reason: "That looks like a key, not an account id. The account id is the short 0.0.x number." };
  }
  if (!ACCOUNT_ID.test(trimmed)) return { ok: false, reason: "An account id looks like 0.0.12345." };
  return { ok: true, accountId: trimmed };
}
