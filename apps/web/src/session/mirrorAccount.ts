/**
 * One mirror-node read, before any secret is typed: does this account exist
 * on testnet, which curve controls it, and can it pay a submit fee.
 *
 * `GET /api/v1/accounts/{id}` on the public testnet mirror node. Verified
 * against a live response on 2026-09-07: the body carries `key._type`
 * (`ECDSA_SECP256K1` or `ED25519`, or `ProtobufEncoded` for anything more
 * complex), `key.key` (the public key, hex), `balance.balance` (tinybars, a
 * JSON integer) and `deleted`. The mirror node answers browsers directly,
 * with `access-control-allow-origin: *`. Hashscan is not involved.
 *
 * Testnet only; there is no other base URL here. Mock mode never calls this:
 * a real balance under a MOCK banner would be the mode confusion the banner
 * exists to prevent.
 *
 * Every outcome is a value, not a throw. The screen decides what blocks.
 */

import { parseTinybars } from "@handoff/schema";

export const MIRROR_TESTNET_BASE = "https://testnet.mirrornode.hedera.com";

export const LOOKUP_TIMEOUT_MS = 5_000;

export type MirrorKeyType = "ECDSA_SECP256K1" | "ED25519";

export type AccountLookup =
  | {
      readonly status: "found";
      readonly accountId: string;
      readonly keyType: MirrorKeyType;
      /** Hex, as the mirror node returns it. Public by definition. */
      readonly publicKey: string;
      /** Tinybars as a string. Null if the number could not be carried exactly. */
      readonly balanceTinybars: string | null;
      readonly deleted: boolean;
    }
  | { readonly status: "unsupported-key"; readonly accountId: string; readonly reported: string }
  | { readonly status: "not-found"; readonly accountId: string }
  | { readonly status: "unreachable"; readonly accountId: string; readonly reason: string };

export interface LookupDeps {
  readonly fetch: typeof fetch;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export function accountLookupUrl(accountId: string): string {
  return `${MIRROR_TESTNET_BASE}/api/v1/accounts/${encodeURIComponent(accountId)}?transactions=false`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A balance the money module will accept, or null. The mirror node sends a
 * JSON integer; a string is tolerated only if it is exactly what
 * `parseTinybars` takes, so the chip can never throw on what this returns.
 */
function tinybarsFrom(value: unknown): string | null {
  const text =
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? String(value)
      : typeof value === "string"
        ? value
        : null;
  if (text === null || text.startsWith("-")) return null;
  try {
    parseTinybars(text);
  } catch {
    return null;
  }
  return text;
}

/** Maps a decoded body to a result. Exported for the tests; the fetch is the thin part. */
export function interpretAccountBody(accountId: string, body: unknown): AccountLookup {
  // The mirror node always echoes the account it is describing. Anything
  // else that came back with a 2xx is not the mirror node's answer.
  if (!isRecord(body) || typeof body["account"] !== "string") {
    return { status: "unreachable", accountId, reason: "the mirror node answered with something that is not an account" };
  }
  const key = body["key"];
  if (!isRecord(key) || typeof key["_type"] !== "string" || typeof key["key"] !== "string") {
    return { status: "unsupported-key", accountId, reported: "no single key" };
  }
  const type = key["_type"];
  if (type !== "ECDSA_SECP256K1" && type !== "ED25519") {
    return { status: "unsupported-key", accountId, reported: type };
  }
  const balance = body["balance"];
  return {
    status: "found",
    accountId,
    keyType: type,
    publicKey: key["key"],
    balanceTinybars: isRecord(balance) ? tinybarsFrom(balance["balance"]) : null,
    deleted: body["deleted"] === true,
  };
}

export async function lookupAccount(accountId: string, deps: LookupDeps): Promise<AccountLookup> {
  const controller = new AbortController();
  const timeoutMs = deps.timeoutMs ?? LOOKUP_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(new Error(`no answer in ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
  const onOuterAbort = () => controller.abort(deps.signal?.reason);
  deps.signal?.addEventListener("abort", onOuterAbort, { once: true });

  try {
    const response = await deps.fetch(accountLookupUrl(accountId), {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (response.status === 404) return { status: "not-found", accountId };
    if (!response.ok) return { status: "unreachable", accountId, reason: `HTTP ${response.status}` };
    return interpretAccountBody(accountId, await response.json());
  } catch (error) {
    // A thrown fetch is the browser's wording ("Failed to fetch", "Load
    // failed"); the screen gets one phrase for all of them.
    const reason =
      controller.signal.aborted && controller.signal.reason instanceof Error
        ? controller.signal.reason.message
        : error instanceof TypeError
          ? "network error"
          : error instanceof Error
            ? error.message
            : String(error);
    return { status: "unreachable", accountId, reason };
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener("abort", onOuterAbort);
  }
}
