/**
 * Posting a request, as far as a browser is allowed to take it.
 *
 * The resource server's create flow has two calls. The first is free and
 * needs no key: it prices the service fee and mints the order id, and hands
 * back the fund-lock transfer the requester will sign. The second is the paid
 * retry, and it needs two signatures from the requester's own ECDSA key — one
 * on the x402 service fee, one on the fund lock.
 *
 * **This app performs the first call and stops.** Not as a simplification: it
 * is where this app's rules end. `apps/web/CLAUDE.md` says the expert app
 * never holds a key beyond the connected expert's, and the second call needs
 * the requester's key to sign money out of the requester's own account. The
 * signer for that is `X402Signer` in `packages/chain`, which states in its own
 * header that nothing there reaches a browser build, and it is right to: the
 * ratified home of the x402 payer signing is server-side
 * (`docs/decisions/2026-09-07-x402-signer-lives-in-packages-chain.md`).
 *
 * So the panel gets the real price and the real order id from the real server,
 * then hands the finish to the thing that is built to do it: the
 * `handoff_verify` tool, which pays the fee and locks the funds from the
 * configured account. Nothing here is a simulation and nothing here is faked
 * — every number on screen came off the wire.
 *
 * Bounds come from `@handoff/schema` rather than being restated, so the form
 * refuses exactly what the server would refuse.
 */

import {
  assertPositive,
  CLAIM_TIMEOUT_MAX_SECONDS,
  CLAIM_TIMEOUT_MAX_SHARE_OF_WINDOW,
  CLAIM_TIMEOUT_MIN_SECONDS,
  hbarToTinybars,
} from "@handoff/schema";

/** What the person typed. Strings, because that is what a form has. */
export interface RequestDraft {
  readonly spec: string;
  readonly artifact: string;
  readonly certTag: string;
  readonly priceHbar: string;
  /** UTC, second precision, `Z` only — the envelope's own rule. */
  readonly deadline: string;
  readonly claimTimeoutSeconds: string;
}

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const HOUR_MS = 3_600_000;

/** Long enough for a real review. The form opens on it rather than on blank. */
export const DEFAULT_DEADLINE_DAYS = 3;

/**
 * Ten minutes. Above the treaty's floor, and short next to a three-day
 * deadline — which is the whole reason the two clocks are separate. A
 * claimant who walks away frees the order quickly instead of sitting on it.
 */
export const DEFAULT_CLAIM_TIMEOUT_SECONDS = 600;

/** UTC, second precision, `Z`. Empty for anything that is not a real instant. */
function utcSecond(at: Date): string {
  if (Number.isNaN(at.getTime())) return "";
  const text = `${at.toISOString().slice(0, 19)}Z`;
  return UTC.test(text) ? text : "";
}

/** Three days out, on the hour, so the form opens on a deadline that works. */
export function defaultDeadline(now: Date): string {
  const at = new Date(now.getTime() + DEFAULT_DEADLINE_DAYS * 24 * HOUR_MS);
  at.setMinutes(0, 0, 0);
  return utcSecond(new Date(at.getTime() + HOUR_MS));
}

/** A new draft. Takes the clock because two of its defaults are times. */
export function emptyDraft(now: Date): RequestDraft {
  return {
    spec: "",
    artifact: "",
    certTag: "",
    priceHbar: "100",
    deadline: defaultDeadline(now),
    claimTimeoutSeconds: String(DEFAULT_CLAIM_TIMEOUT_SECONDS),
  };
}

/**
 * The two sides of the date picker, which speaks local wall-clock time with
 * no zone while the envelope takes UTC. Converting in one tested place is
 * what keeps a deadline picked in Ulaanbaatar meaning the instant that person
 * meant, and it is why the field shows the UTC instant back.
 */
export function deadlineForPicker(deadline: string): string {
  if (!UTC.test(deadline.trim())) return "";
  const at = new Date(deadline.trim());
  if (Number.isNaN(at.getTime())) return "";
  const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
  return (
    `${pad(at.getFullYear(), 4)}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}`
  );
}

/** What the picker hands back is local time. Anything else is no deadline. */
export function deadlineFromPicker(local: string): string {
  return local.trim() === "" ? "" : utcSecond(new Date(local.trim()));
}

/**
 * Everything wrong with the draft, in the order the fields appear. Plain
 * sentences: the copy dictionary bans the engineering words, and a person
 * reading this is deciding where their money goes.
 */
export function draftProblems(draft: RequestDraft, now: Date): readonly string[] {
  const problems: string[] = [];

  if (draft.spec.trim() === "") problems.push("Say what you want reviewed.");
  if (draft.artifact.trim() === "") problems.push("Add the work to be reviewed.");
  if (draft.certTag === "") problems.push("Choose who should review it.");

  try {
    assertPositive(hbarToTinybars(draft.priceHbar.trim()));
  } catch {
    problems.push("The price must be an amount of HBAR, like 100.");
  }

  if (!UTC.test(draft.deadline.trim())) {
    problems.push("The deadline must be a UTC time like 2026-09-14T00:00:00Z.");
  }

  const seconds = Number(draft.claimTimeoutSeconds.trim());
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    problems.push("The claim window must be a whole number of seconds.");
  } else if (seconds < CLAIM_TIMEOUT_MIN_SECONDS || seconds > CLAIM_TIMEOUT_MAX_SECONDS) {
    problems.push(
      `The claim window must be between ${CLAIM_TIMEOUT_MIN_SECONDS} and ${CLAIM_TIMEOUT_MAX_SECONDS} seconds.`,
    );
  } else if (UTC.test(draft.deadline.trim())) {
    // The relative rule, checked here so the form refuses what the server
    // would. A claim window close to the deadline lets a lazy claimant hold
    // the money, which is the whole reason the two are separate.
    const window = Math.floor((Date.parse(draft.deadline.trim()) - now.getTime()) / 1000);
    if (window <= 0) {
      problems.push("The deadline has already passed.");
    } else if (seconds > Math.floor(window * CLAIM_TIMEOUT_MAX_SHARE_OF_WINDOW)) {
      problems.push(
        `The claim window is too close to the deadline. With this deadline it can be at most ` +
          `${Math.floor(window * CLAIM_TIMEOUT_MAX_SHARE_OF_WINDOW)} seconds.`,
      );
    }
  }

  return problems;
}

/**
 * Base64 for the artifact, because JSON has no bytes. The document is
 * fabricated demo content (hard rule 7) and is never published — the server
 * stores it and puts only its hash on the topic.
 */
export function encodeArtifact(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The body of the first, free call. `order_id` and the lock come back from it. */
export function orderRequestBody(
  draft: RequestDraft,
  requesterAccountId: string,
): Record<string, string | number> {
  return {
    class: "review",
    requester_account_id: requesterAccountId,
    spec: draft.spec.trim(),
    artifact_base64: encodeArtifact(draft.artifact),
    cert_tag: draft.certTag,
    price_hbar: draft.priceHbar.trim(),
    deadline: draft.deadline.trim(),
    claim_timeout_seconds: Number(draft.claimTimeoutSeconds.trim()),
  };
}

/** The quote and the lock, as the 402 states them. Every field off the wire. */
export interface Quote {
  readonly orderId: string;
  readonly escrowAccountId: string;
  /** The order value's lock expires; after that the 402 has to be asked again. */
  readonly validUntil: string | null;
  /** The x402 service fee, in tinybars. The other money flow, never the order value. */
  readonly serviceFeeTinybars: string | null;
  /** Who the fee is paid to. Separate from the escrow, always. */
  readonly payTo: string | null;
}

export type QuoteOutcome =
  | { readonly kind: "quoted"; readonly quote: Quote }
  /** The server answered and said no. Its own sentence, which ends "Nothing was charged." */
  | { readonly kind: "refused"; readonly message: string }
  /** The browser never got an answer. Almost always the cross-origin block. */
  | { readonly kind: "unreachable"; readonly message: string }
  /** A 402 arrived but did not carry a lock, so there is nothing to sign. */
  | { readonly kind: "unusable"; readonly message: string };

function stringAt(value: Record<string, unknown>, key: string): string | null {
  const found = value[key];
  return typeof found === "string" && found !== "" ? found : null;
}

/** Read the 402's body. Parsed rather than cast; this decides what is signed. */
export function decodeQuote(body: unknown): Quote | null {
  if (typeof body !== "object" || body === null) return null;
  const top = body as Record<string, unknown>;

  const lock = top["fund_lock"];
  if (typeof lock !== "object" || lock === null) return null;
  const fundLock = lock as Record<string, unknown>;

  const orderId = stringAt(fundLock, "order_id");
  const escrowAccountId = stringAt(fundLock, "escrow_account_id");
  if (orderId === null || escrowAccountId === null) return null;

  // `accepts` is @x402/core's shape and stays untouched; this only reads it.
  const accepts = top["accepts"];
  const first = Array.isArray(accepts) && accepts.length > 0 ? accepts[0] : null;
  const quoted = typeof first === "object" && first !== null ? (first as Record<string, unknown>) : null;

  return {
    orderId,
    escrowAccountId,
    validUntil: stringAt(fundLock, "valid_until"),
    serviceFeeTinybars: quoted === null ? null : stringAt(quoted, "amount"),
    payTo: quoted === null ? null : stringAt(quoted, "payTo"),
  };
}

export interface QuoteParams {
  readonly apiUrl: string;
  readonly draft: RequestDraft;
  readonly requesterAccountId: string;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

/**
 * Ask the server to price this order and build its fund lock.
 *
 * Nothing is charged by this call and nothing is published by it. A 402 is the
 * success case — it is the server quoting a price, which is what was asked.
 */
export async function requestQuote(params: QuoteParams): Promise<QuoteOutcome> {
  const fetchImpl = params.fetchImpl ?? ((input, init) => fetch(input, init));
  const url = `${params.apiUrl.replace(/\/+$/, "")}/orders`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orderRequestBody(params.draft, params.requesterAccountId)),
      ...(params.signal === undefined ? {} : { signal: params.signal }),
    });
  } catch {
    // A blocked cross-origin request is indistinguishable from an outage here
    // — the browser hides which on purpose — so the message names both and
    // does not guess.
    return {
      kind: "unreachable",
      message:
        "The ordering service did not answer. It either refused this page's origin or is not " +
        "running. Nothing was sent.",
    };
  }

  if (response.status === 402) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: "unusable", message: "The service quoted a price in a form this page could not read." };
    }
    const quote = decodeQuote(body);
    if (quote === null) {
      return { kind: "unusable", message: "The service quoted a price but did not say where the money would go." };
    }
    return { kind: "quoted", quote };
  }

  let message = `The ordering service answered ${response.status}.`;
  try {
    const body = (await response.json()) as Record<string, unknown>;
    message = stringAt(body, "message") ?? stringAt(body, "error") ?? message;
  } catch {
    // Keep the status line. The server always sends JSON; this is the case
    // where something in front of it did not.
  }
  return { kind: "refused", message };
}

/**
 * The arguments to hand `handoff_verify`, which finishes what this cannot.
 *
 * The artifact goes as the text that was typed, not as base64: the tool takes
 * the document itself and does its own encoding.
 */
export function handoffVerifyArguments(draft: RequestDraft): string {
  return JSON.stringify(
    {
      spec: draft.spec.trim(),
      artifact: draft.artifact,
      cert_tag: draft.certTag,
      price_hbar: draft.priceHbar.trim(),
      deadline: draft.deadline.trim(),
      claim_timeout_seconds: Number(draft.claimTimeoutSeconds.trim()),
    },
    null,
    2,
  );
}
