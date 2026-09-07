/**
 * Who is signing, and whether the connect screen may let them.
 *
 * `ExpertConnection` is what the screen hands to `createWebChain`. It is
 * tagged by mode so the wrong shape cannot be built: the mock member has no
 * key slot at all, because the mock signs nothing, and the testnet member
 * cannot exist without one. `credential.kind` is the slot where a wallet
 * signer lands later, additively; nothing pretends to support one today.
 *
 * `assessConnect` is the screen's whole rulebook as a pure function, so every
 * rule below is a table test rather than a click. It never sees the key text,
 * only its shape.
 */

import { hbarToTinybars, parseTinybars, tinybarsToDisplay } from "@handoff/schema";
import type { ChainMode } from "../chain/config";
import { parseAccountId } from "./accountId";
import { describePrivateKey, type KeyCurve, type KeyShape } from "./keyShape";
import type { AccountLookup } from "./mirrorAccount";
import { scrubHex, SecretKey, SecretUnavailable } from "./secret";

/** Below this the submit fee is in doubt and the screen says so. Display and comparison only. */
const LOW_BALANCE_TINYBARS = hbarToTinybars("1");

export type ExpertKeyType = KeyCurve;

export interface KeyCredential {
  readonly kind: "key";
  /** Which curve to parse the key as. Pinned here so the adapter never guesses. */
  readonly keyType: ExpertKeyType;
  readonly key: SecretKey;
}

export type ExpertCredential = KeyCredential;

export type ExpertConnection =
  | { readonly mode: "mock"; readonly accountId: string }
  | {
      readonly mode: "testnet";
      readonly accountId: string;
      readonly credential: ExpertCredential;
      /** From the mirror node, for the adapter to check the key against. Null if it did not answer. */
      readonly accountPublicKey: string | null;
    };

export interface ConnectDraft {
  readonly mode: ChainMode;
  readonly accountIdText: string;
  /** Null until something has been pasted into the key field. Testnet only. */
  readonly keyShape: KeyShape | null;
  /** Null while the mirror node has not been asked or has not answered. Testnet only. */
  readonly lookup: AccountLookup | null;
}

export interface ConnectAssessment {
  readonly accountId: string | null;
  /** Why the button is disabled, in the order the expert would fix things. Empty means ready. */
  readonly blockers: readonly string[];
  /** Worth saying, not worth blocking. */
  readonly warnings: readonly string[];
  /** Resolved curve, when the draft resolves one. Testnet only. */
  readonly keyType: ExpertKeyType | null;
  readonly ready: boolean;
}

const KEY_WORDS: Record<KeyCurve, string> = { ED25519: "ED25519", ECDSA_SECP256K1: "ECDSA" };

export function keyTypeWords(keyType: KeyCurve): string {
  return KEY_WORDS[keyType];
}

/** For the chip: the balance in HBAR, or null when the mirror node did not carry it exactly. */
export function balanceWords(lookup: AccountLookup): string | null {
  if (lookup.status !== "found" || lookup.balanceTinybars === null) return null;
  return tinybarsToDisplay(parseTinybars(lookup.balanceTinybars));
}

export function assessConnect(draft: ConnectDraft): ConnectAssessment {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const id = parseAccountId(draft.accountIdText);
  const accountId = id.ok ? id.accountId : null;
  if (!id.ok) blockers.push(id.reason);

  if (draft.mode === "mock") {
    return { accountId, blockers, warnings, keyType: null, ready: blockers.length === 0 };
  }

  const lookup = accountId === null ? null : draft.lookup;
  const shape = draft.keyShape ?? describePrivateKey("");
  let keyType: ExpertKeyType | null = shape.ok && shape.encoding === "der" ? shape.curve : null;

  if (accountId !== null) {
    if (lookup === null) {
      blockers.push("Waiting for testnet's mirror node, its public read API, to confirm the account.");
    } else if (lookup.status === "not-found") {
      blockers.push(`Account ${accountId} is not on testnet. Check the id, and that the portal account is a testnet one.`);
    } else if (lookup.status === "unsupported-key") {
      blockers.push(
        `Account ${accountId} is controlled by a key this app cannot sign for (${lookup.reported}). Use an account with one ED25519 or ECDSA key.`,
      );
    } else if (lookup.status === "found" && lookup.deleted) {
      blockers.push(`Account ${accountId} has been deleted on testnet.`);
    }
  }

  if (!shape.ok) {
    blockers.push(shape.reason);
  } else if (lookup?.status === "found" && !lookup.deleted) {
    if (shape.encoding === "der" && shape.curve !== lookup.keyType) {
      blockers.push(
        `This key is ${keyTypeWords(shape.curve)}, but account ${accountId} is controlled by an ${keyTypeWords(lookup.keyType)} key. Paste the key that belongs to this account.`,
      );
    } else if (shape.encoding === "raw") {
      keyType = lookup.keyType;
    }
  } else if (lookup?.status === "unreachable") {
    if (shape.encoding === "der") {
      warnings.push(
        `Testnet's mirror node did not answer (${lookup.reason}). You can still connect; if this key does not belong to the account, the first signature will fail and say so.`,
      );
    } else {
      blockers.push(
        `Testnet's mirror node did not answer (${lookup.reason}), and a plain hex key does not say which type it is. Paste the DER form from the Hedera portal, which starts with 302e or 3030, or retry.`,
      );
    }
  }

  if (
    lookup?.status === "found" &&
    !lookup.deleted &&
    lookup.balanceTinybars !== null &&
    parseTinybars(lookup.balanceTinybars) < LOW_BALANCE_TINYBARS
  ) {
    warnings.push(
      `This account has ${balanceWords(lookup)}. Publishing a verdict costs a small fee; get free test HBAR from the Hedera portal first.`,
    );
  }

  const ready = blockers.length === 0 && keyType !== null;
  if (blockers.length === 0 && keyType === null) {
    // Cannot happen by the rules above, but the type says it can, and a
    // ready button with no curve would be a guess at sign time.
    blockers.push("The key's curve could not be determined. Paste the DER form from the portal.");
  }
  return { accountId, blockers, warnings, keyType, ready };
}

/**
 * The connection the Connect button hands over, or null if the assessment
 * does not allow one. `takeKey` reads the key field exactly once, and only
 * on the testnet path: the mock member has nowhere to put a key, so on the
 * mock the field is never read. Pure apart from that one read, so the
 * table test covers what the click handler does with the key.
 */
export function buildConnection(
  draft: { readonly mode: ChainMode; readonly assessment: ConnectAssessment; readonly lookup: AccountLookup | null },
  takeKey: () => string,
): ExpertConnection | null {
  const { mode, assessment, lookup } = draft;
  if (!assessment.ready || assessment.accountId === null) return null;
  if (mode === "mock") return { mode: "mock", accountId: assessment.accountId };
  if (assessment.keyType === null) return null;
  return {
    mode: "testnet",
    accountId: assessment.accountId,
    credential: { kind: "key", keyType: assessment.keyType, key: SecretKey.fromInput(takeKey()) },
    accountPublicKey: lookup?.status === "found" ? lookup.publicKey : null,
  };
}

/**
 * What the screen says when connecting failed, in words the app chose. An
 * adapter or SDK message can quote its input, so anything not recognised is
 * scrubbed of long hex runs before it is shown.
 */
export function describeConnectError(error: unknown, accountId: string): string {
  if (error instanceof SecretUnavailable) return error.message;
  if (error instanceof Error && error.name === "KeyMismatchError") {
    return `This key does not belong to account ${accountId}. Paste the key the portal shows for it.`;
  }
  const message = error instanceof Error ? error.message : String(error);
  return scrubHex(message);
}
