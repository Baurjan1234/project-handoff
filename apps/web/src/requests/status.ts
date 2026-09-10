/**
 * What the resource server can prove about one order, read over HTTP.
 *
 * `GET {api}/orders/{id}` is free and unauthenticated by decision — the gate
 * covers order posting only, and everything this returns is already on a
 * public topic that any mirror node serves without asking us. So the browser
 * may read it directly, with no key and no payment.
 *
 * **Parsed, never cast.** These words go in front of the person whose money is
 * in escrow, so a malformed or hostile answer has to be distinguishable from a
 * real one. `apps/web` has no zod dependency and is not getting one for this,
 * so the decoder is written out: every field is checked, unknown fields are
 * ignored, and anything unexpected becomes `null` rather than a value the
 * screen will present as fact. Same approach as `orders/claim.ts`.
 *
 * `claimReadable` is the server saying whether it can see claims at all. When
 * it is false the screen must not say "nobody has claimed this" — only that
 * claims are not visible from here. It is false today: claims are published to
 * the orders topic by the expert app and the server does not yet read them.
 */

const VERDICTS = ["approve", "approve_with_changes", "reject"] as const;
export type RequestVerdict = (typeof VERDICTS)[number];

const STATES = ["POSTED", "DELIVERED", "UNKNOWN"] as const;
export type RequestState = (typeof STATES)[number];

/** The envelope's fields this screen shows. A subset, read defensively. */
export interface RequestEnvelope {
  readonly certTag: string | null;
  readonly priceTinybars: string | null;
  readonly deadline: string | null;
  readonly orderClass: string | null;
}

export interface RequestStatus {
  readonly orderId: string;
  readonly state: RequestState;
  readonly envelope: RequestEnvelope | null;
  readonly postedAt: string | null;
  readonly verdict: RequestVerdict | null;
  /** How many issue codes the verdict carries. Null when there is no verdict. */
  readonly defectCount: number | null;
  /** The account that paid to submit the verdict. Not proof of a credential. */
  readonly signedBy: string | null;
  readonly signedAt: string | null;
  readonly claimReadable: boolean;
}

function objectAt(value: unknown, key: string): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  const found = (value as Record<string, unknown>)[key];
  if (typeof found !== "object" || found === null || Array.isArray(found)) return null;
  return found as Record<string, unknown>;
}

function stringAt(value: Record<string, unknown>, key: string): string | null {
  const found = value[key];
  return typeof found === "string" && found !== "" ? found : null;
}

export function decodeStatus(body: unknown): RequestStatus | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const top = body as Record<string, unknown>;

  const orderId = stringAt(top, "orderId");
  if (orderId === null) return null;

  const rawState = top["state"];
  const state = STATES.find((s) => s === rawState) ?? "UNKNOWN";

  const rawEnvelope = objectAt(top, "envelope");
  const envelope: RequestEnvelope | null =
    rawEnvelope === null
      ? null
      : {
          certTag: stringAt(rawEnvelope, "cert_tag"),
          priceTinybars: stringAt(rawEnvelope, "price_tinybars"),
          deadline: stringAt(rawEnvelope, "deadline"),
          orderClass: stringAt(rawEnvelope, "class"),
        };

  const rawAttestation = objectAt(top, "attestation");
  const rawVerdict = top["verdict"] ?? rawAttestation?.["verdict"];
  const verdict = VERDICTS.find((v) => v === rawVerdict) ?? null;

  const defects = rawAttestation?.["defects"];
  const defectCount = Array.isArray(defects) ? defects.length : verdict === null ? null : 0;

  return {
    orderId,
    state,
    envelope,
    postedAt: stringAt(top, "postedAt"),
    verdict,
    defectCount,
    signedBy: stringAt(top, "signedBy"),
    signedAt: stringAt(top, "signedAt"),
    claimReadable: top["claimReadable"] === true,
  };
}

export interface StatusParams {
  readonly apiUrl: string;
  readonly orderId: string;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

/**
 * Read one order's status. Returns null when the server answers something this
 * cannot make sense of, which the screen reports as "not read" rather than as
 * an absence of the thing.
 */
export async function fetchRequestStatus(params: StatusParams): Promise<RequestStatus | null> {
  const fetchImpl = params.fetchImpl ?? ((input, init) => fetch(input, init));
  const url = `${params.apiUrl.replace(/\/+$/, "")}/orders/${encodeURIComponent(params.orderId)}`;
  const response = await fetchImpl(url, params.signal === undefined ? {} : { signal: params.signal });
  if (!response.ok) return null;
  try {
    return decodeStatus(await response.json());
  } catch {
    return null;
  }
}
