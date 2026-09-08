/**
 * The two checks that have to happen before a payment is signed.
 *
 * Both failures are things the server cannot see. It knows neither the payer's
 * key type nor their balance, so a requester who is going to fail fails at the
 * facilitator with an opaque `InvalidSignature`, or halfway through with the
 * fee gone. Checking here means every reply ends "Nothing was charged." and
 * means it.
 *
 * Copy is `docs/design-system.md` under "MCP replies", beat 2. Moved into this
 * lane from NAS-36 on 2026-09-08, because the server cannot produce either
 * sentence.
 *
 * One mirror-node read answers both: `GET /api/v1/accounts/{id}` carries
 * `key._type` and `balance.balance`. That is a plain HTTP read, not the Hedera
 * SDK, which this app must never import. Mirror nodes are read directly;
 * Hashscan is a viewer, not a dependency.
 */

import { formatTinybars, parseTinybars, tinybarsToHbar } from "@handoff/schema";

export type MirrorKeyType = "ECDSA_SECP256K1" | "ED25519";

/** What the mirror node said about an account, or why it could not say. */
export type AccountFacts =
  | {
      readonly status: "found";
      readonly keyType: MirrorKeyType | "other";
      /** Tinybars as a string. Money is never a number. */
      readonly balanceTinybars: string;
    }
  | { readonly status: "not-found" }
  | { readonly status: "unreachable"; readonly reason: string };

export interface PreflightDeps {
  readonly mirrorNodeUrl: string;
  readonly fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read one account.
 *
 * Every outcome is a value, never a throw. A mirror node that is down must not
 * stop an order the payer could have afforded — the caller decides whether an
 * unreadable account blocks, and it does not.
 */
export async function readAccount(
  accountId: string,
  deps: PreflightDeps,
): Promise<AccountFacts> {
  const call = deps.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const base = deps.mirrorNodeUrl.replace(/\/+$/, "");
  const url = `${base}/accounts/${encodeURIComponent(accountId)}?transactions=false`;

  let response: Response;
  try {
    response = await call(url, {
      signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    return { status: "unreachable", reason: (error as Error).message };
  }

  if (response.status === 404) return { status: "not-found" };
  if (!response.ok) {
    return { status: "unreachable", reason: `mirror node answered ${response.status}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    return { status: "unreachable", reason: (error as Error).message };
  }
  if (!isRecord(body)) return { status: "unreachable", reason: "mirror node sent no account" };

  const key = isRecord(body["key"]) ? body["key"] : undefined;
  const reported = key === undefined ? undefined : key["_type"];
  const keyType: MirrorKeyType | "other" =
    reported === "ECDSA_SECP256K1" || reported === "ED25519" ? reported : "other";

  const balance = isRecord(body["balance"]) ? body["balance"]["balance"] : undefined;
  let balanceTinybars: string;
  try {
    // Through the money module, never a bare Number(). A balance that will not
    // parse is an unreadable account, not a zero balance — reading it as zero
    // would refuse an order the payer could afford.
    balanceTinybars = formatTinybars(parseTinybars(String(balance ?? "")));
  } catch {
    return { status: "unreachable", reason: "mirror node sent no usable balance" };
  }

  return { status: "found", keyType, balanceTinybars };
}

export interface PreflightRequest {
  /** The account the service fee is debited from. Must be ECDSA. */
  readonly payerAccountId: string;
  /** The service fee, in tinybars. */
  readonly feeTinybars: string;
  /**
   * The order value, in tinybars, when the payer's own account also funds the
   * escrow. Absent when the escrow is funded from another account, in which
   * case this payer only needs the fee.
   */
  readonly escrowTinybars?: string;
}

export type Preflight =
  | { readonly ok: true }
  | { readonly ok: false; readonly reply: string };

/**
 * Decide whether to sign, and say why not in the requester's own words.
 *
 * An account the mirror node cannot describe is **not** a refusal. Being unable
 * to check is not evidence of a problem, and blocking on it would turn a mirror
 * outage into "you cannot order" — the facilitator still refuses a bad payment,
 * and nothing is charged when it does.
 */
export async function preflight(
  request: PreflightRequest,
  deps: PreflightDeps,
): Promise<Preflight> {
  const facts = await readAccount(request.payerAccountId, deps);
  if (facts.status !== "found") return { ok: true };

  if (facts.keyType !== "ECDSA_SECP256K1") {
    // The x402 scheme is secp256k1. An ED25519 account produces a payload that
    // verifies as invalid, and that error names the signature rather than the
    // key type, which is an evening lost.
    const named = facts.keyType === "other" ? "a key this service cannot use" : "an ED25519 key";
    return {
      ok: false,
      reply:
        `Your account ${request.payerAccountId} uses ${named}. ` +
        `The service fee needs an ECDSA account. Nothing was charged.`,
    };
  }

  const fee = parseTinybars(request.feeTinybars);
  const escrow = request.escrowTinybars === undefined ? 0n : parseTinybars(request.escrowTinybars);
  const needed = fee + escrow;
  if (parseTinybars(facts.balanceTinybars) >= needed) return { ok: true };

  const held = tinybarsToHbar(parseTinybars(facts.balanceTinybars));
  const feeHbar = tinybarsToHbar(fee);
  const posting =
    escrow === 0n
      ? `Posting needs ${feeHbar} HBAR for the fee.`
      : `Posting needs ${feeHbar} HBAR for the fee plus ` +
        `${tinybarsToHbar(escrow)} HBAR for escrow.`;

  return {
    ok: false,
    reply: `Your account holds ${held} HBAR. ${posting} Nothing was charged.`,
  };
}
