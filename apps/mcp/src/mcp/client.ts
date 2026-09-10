/**
 * The paying client behind the `handoff_verify` tool.
 *
 * The tool is not the gate. It is a customer of the gate: it calls
 * `POST /orders`, and if the answer is 402 it pays and calls again. That is
 * the whole reason the 402 lives in HTTP — see
 * `../../../../docs/decisions/2026-09-05-402-lives-in-an-http-resource-server.md`.
 *
 * Signing is a port, not an implementation. Building a Hedera
 * `TransferTransaction` and partially signing it with an ECDSA key is the one
 * thing here that needs a Hedera dependency, and where that dependency is
 * allowed to live is an open rule question for the team. Until it is settled,
 * the only signer wired up is one that refuses and says why, which keeps
 * everything either side of it finished and testable.
 */

import type { PaymentRequired, PaymentRequirements } from "../x402/types.js";
import { PAYMENT_REQUIRED_HEADER, PAYMENT_SIGNATURE_HEADER } from "../x402/gate.js";
import type { CertTagOption } from "../config.js";
import { OrderStatusShape, type OrderStatus } from "../status.js";

export class HandoffClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandoffClientError";
  }
}

export class PaymentUnavailableError extends HandoffClientError {
  constructor(requirements: PaymentRequirements) {
    super(
      `this order costs ${requirements.amount} tinybars to ${requirements.payTo} on ` +
        `${requirements.network}, and no payment signer is wired into this build yet. ` +
        `The signer needs an ECDSA key and the x402 client library.`,
    );
    this.name = "PaymentUnavailableError";
  }
}

/**
 * A refusal decided before anything was signed.
 *
 * Carries the sentence the requester reads. It is a distinct error because the
 * tool answers with the copy rather than with "the order failed" — and because
 * nothing was charged, which is what every one of these sentences ends with.
 */
export class PreflightRefusedError extends HandoffClientError {
  constructor(readonly reply: string) {
    super(reply);
    this.name = "PreflightRefusedError";
  }
}

/**
 * Checked after the price is known and before the payment is built.
 *
 * After, because the fee is the server's to state and a check against a
 * guessed price is worse than none. Before, because the whole point is that
 * nothing is charged.
 */
export type PreflightCheck = (
  requirements: PaymentRequirements,
  /**
   * The order value, which this same account now funds the escrow with.
   *
   * Checking the fee alone let a caller through who could pay 0.5 HBAR and not
   * the 100 behind it; they found out at the lock, after paying.
   */
  priceHbar: string,
) => Promise<{ readonly ok: true } | { readonly ok: false; readonly reply: string }>;

/**
 * Turns payment requirements into the base64 payload that goes in the
 * `PAYMENT-SIGNATURE` header.
 */
export interface PaymentSigner {
  sign(requirements: PaymentRequirements): Promise<string>;
  /**
   * Sign the fund lock the server built, here, with the key that signs the fee.
   *
   * The escrow is funded by the requester's own signature now, so this is not
   * optional for ordering. The key never leaves this process — see
   * ../../../../docs/decisions/2026-09-08-requester-signs-the-fund-lock.md.
   */
  signFundLock(transactionBytes: string): Promise<string>;
}

/** The only signer that exists today. It fails with the price in the message. */
export class UnwiredSigner implements PaymentSigner {
  async sign(requirements: PaymentRequirements): Promise<never> {
    throw new PaymentUnavailableError(requirements);
  }

  async signFundLock(): Promise<never> {
    // Unreachable in practice: `sign` refuses first and the fund lock is only
    // signed after a quote has been paid for. Stated rather than left to
    // throw something shapeless if the order of operations ever changes.
    throw new HandoffClientError(
      "this session has no payer account, so it cannot sign a fund lock",
    );
  }
}

export interface OrderInput {
  readonly spec: string;
  readonly artifact: string;
  readonly certTag: string;
  readonly priceHbar: string;
  readonly deadline: string;
  readonly claimTimeoutSeconds: number;
}

/** What a free read needs: no signer, because nothing is being paid for. */
export interface ReadDeps {
  readonly baseUrl: string;
  readonly fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

export interface ClientDeps extends ReadDeps {
  readonly signer: PaymentSigner;
  /**
   * The account this client pays from, which is therefore the account whose
   * funds the escrow locks. The service checks it against the account the
   * facilitator says paid, so it is the payer's id or nothing.
   *
   * Optional because a build with no payer wired up has no account to name.
   * That build's signer refuses at the 402 and never posts, so the order body
   * it would have sent is never parsed.
   */
  readonly requesterAccountId?: string;
  /** Optional. Absent means sign whatever is quoted, which is the old behaviour. */
  readonly preflight?: PreflightCheck;
}

function base(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/** The paid retry adds what the 402 minted; the first call has neither yet. */
interface SignedLock {
  readonly orderId: string;
  readonly signedFundLock: string;
}

function body(
  input: OrderInput,
  requesterAccountId: string | undefined,
  lock?: SignedLock,
): string {
  return JSON.stringify({
    class: "review",
    requester_account_id: requesterAccountId,
    ...(lock === undefined
      ? {}
      : { order_id: lock.orderId, signed_fund_lock: lock.signedFundLock }),
    spec: input.spec,
    // JSON has no bytes. The text never leaves the content store either way;
    // only its hash is published.
    artifact_base64: Buffer.from(input.artifact, "utf8").toString("base64"),
    cert_tag: input.certTag,
    price_hbar: input.priceHbar,
    deadline: input.deadline,
    claim_timeout_seconds: input.claimTimeoutSeconds,
  });
}

/**
 * Read the price out of a 402.
 *
 * The header is the version 2 channel and the body is the version 1 fallback,
 * so prefer the header and accept either, which is what the reference client
 * does.
 */
/** The transfer the server wants the requester to sign, and the order it is for. */
export interface FundLockChallenge {
  readonly order_id: string;
  readonly escrow_account_id: string;
  readonly transaction_bytes: string;
  readonly memo: string;
  readonly valid_until: string;
}

export interface Challenge {
  readonly requirements: PaymentRequirements;
  readonly fundLock: FundLockChallenge;
}

export async function readChallenge(response: Response): Promise<Challenge> {
  // The body is read once and used twice: it is the version 1 fallback for the
  // challenge, and it is the only channel for the fund lock — that field is
  // ours, not @x402/core's, so it never goes in the header.
  const body = (await response.json()) as PaymentRequired & {
    readonly fund_lock?: FundLockChallenge;
  };
  const header = response.headers.get(PAYMENT_REQUIRED_HEADER.toLowerCase());
  const challenge: PaymentRequired = header
    ? (JSON.parse(Buffer.from(header, "base64").toString("utf8")) as PaymentRequired)
    : body;

  const requirements = challenge.accepts[0];
  if (requirements === undefined) {
    throw new HandoffClientError("the server answered 402 without saying what it costs");
  }
  if (body.fund_lock === undefined) {
    throw new HandoffClientError(
      "the server answered 402 without a fund lock to sign, so the escrow could not be " +
        "funded. Nothing was charged.",
    );
  }
  return { requirements, fundLock: body.fund_lock };
}

/** Post an order, paying if asked. Returns the served body. */
export async function postOrder(
  input: OrderInput,
  deps: ClientDeps,
): Promise<Record<string, unknown>> {
  const call = deps.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const url = `${base(deps.baseUrl)}/orders`;
  const payload = body(input, deps.requesterAccountId);
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  const first = await call(url, { method: "POST", headers, body: payload });
  if (first.status !== 402) {
    return finish(first);
  }

  // Echo back the requirements we were quoted. Sending anything else is
  // rejected by the facilitator before it looks at the transaction at all.
  const { requirements, fundLock } = await readChallenge(first);

  if (deps.preflight !== undefined) {
    // The fee and the order value both come out of this account, so both are
    // checked. Passing only the fee lets a caller through who can pay 0.5 HBAR
    // and not the 100 behind it, and they find out at the lock instead.
    const checked = await deps.preflight(requirements, input.priceHbar);
    if (!checked.ok) throw new PreflightRefusedError(checked.reply);
  }

  const signed = await deps.signer.sign(requirements);
  // Signed here, on this machine. The server gets bytes, never the key.
  const signedFundLock = await deps.signer.signFundLock(fundLock.transaction_bytes);

  const paid = await call(url, {
    method: "POST",
    headers: { ...headers, [PAYMENT_SIGNATURE_HEADER]: signed },
    // The id the 402 minted, echoed back: it is the memo inside those signed
    // bytes and the only thing binding them to this order.
    body: body(input, deps.requesterAccountId, {
      orderId: fundLock.order_id,
      signedFundLock,
    }),
  });

  if (paid.status === 402) {
    const retry = (await paid.json()) as PaymentRequired;
    throw new HandoffClientError(`the payment was rejected: ${retry.error ?? "no reason given"}`);
  }

  return finish(paid);
}

async function finish(response: Response): Promise<Record<string, unknown>> {
  const parsed = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new HandoffClientError(
      `the service answered ${response.status}: ${JSON.stringify(parsed)}`,
    );
  }
  return parsed;
}

/**
 * The credential tags this service routes to.
 *
 * Fetched once at startup so the tool schema can enumerate them. The tag is
 * the routing and there is no broadcast, so an agent that guesses a tag posts
 * an order nobody can see — the list has to be in front of it before it picks.
 */
export async function fetchTags(deps: ReadDeps): Promise<readonly CertTagOption[]> {
  const call = deps.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const response = await call(`${base(deps.baseUrl)}/tags`, { method: "GET" });
  const parsed = (await response.json()) as { tags?: readonly CertTagOption[] };

  if (!response.ok || parsed.tags === undefined || parsed.tags.length === 0) {
    throw new HandoffClientError(
      `${deps.baseUrl} did not say which credentials it routes to, so no order can be posted.`,
    );
  }
  return parsed.tags;
}

/**
 * Read an order's state back.
 *
 * A query, not a poll. Free — reads are ungated by
 * `../../../../docs/decisions/2026-09-05-gate-covers-order-posting-only.md` —
 * so there is no 402 branch here and no signer involved.
 */
export async function fetchStatus(orderId: string, deps: ReadDeps): Promise<OrderStatus> {
  const call = deps.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const response = await call(
    `${base(deps.baseUrl)}/orders/${encodeURIComponent(orderId)}`,
    { method: "GET" },
  );
  // Parsed, not asserted. The verdict in this body goes straight into copy a
  // requester reads, so a malformed answer has to be a failure here rather
  // than a sentence there.
  return OrderStatusShape.parse(await finish(response));
}
