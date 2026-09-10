/**
 * HBAR in dollars, for the two people who do not think in tinybars.
 *
 * The rate is Hedera's own, read from the mirror node at
 * `GET /api/v1/network/exchangerate`, whose shape and arithmetic are the
 * documented ones: `1 hbar = (cent_equivalent / hbar_equivalent) US cents`.
 * No third-party price feed, no oracle, nothing to configure. Hedera's docs
 * are explicit that this rate is what the network charges fees at rather
 * than a live market price, so the screen says "at Hedera's network rate"
 * and never presents a dollar figure as the amount that moved.
 *
 * **HBAR is the amount; dollars are a label.** Every decision, comparison
 * and published field uses the tinybar value from the schema's money
 * module. Nothing here is ever hashed, published, or compared, and nothing
 * here becomes a float: cents are bigint and the division rounds once, at
 * the end, to the nearest cent.
 */

const TINYBARS_PER_HBAR = 100_000_000n;

export interface HbarRate {
  /** Numerator: US cents. */
  readonly centEquivalent: bigint;
  /** Denominator: HBAR. */
  readonly hbarEquivalent: bigint;
}

export class RateUnavailable extends Error {
  constructor(reason: string) {
    super(`The network's exchange rate could not be read: ${reason}`);
    this.name = "RateUnavailable";
  }
}

function positiveInt(value: unknown, field: string): bigint {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new RateUnavailable(`${field} is not a positive whole number`);
  }
  return BigInt(value);
}

/** The current rate, as the mirror node reports it. */
export function interpretRate(body: unknown): HbarRate {
  if (typeof body !== "object" || body === null) throw new RateUnavailable("the answer was not an object");
  const current = (body as { current_rate?: unknown }).current_rate;
  if (typeof current !== "object" || current === null) throw new RateUnavailable("no current_rate");
  const rate = current as { cent_equivalent?: unknown; hbar_equivalent?: unknown };
  return {
    centEquivalent: positiveInt(rate.cent_equivalent, "cent_equivalent"),
    hbarEquivalent: positiveInt(rate.hbar_equivalent, "hbar_equivalent"),
  };
}

export async function fetchHbarRate(
  mirrorNodeUrl: string,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<HbarRate> {
  const response = await fetchImpl(`${mirrorNodeUrl.replace(/\/+$/, "")}/network/exchangerate`);
  if (!response.ok) throw new RateUnavailable(`the mirror node answered ${response.status}`);
  return interpretRate(await response.json());
}

/**
 * Tinybars to US cents, rounded half up, once. Integers throughout: a
 * tinybar count times a cent count divided by an HBAR count.
 */
export function tinybarsToCents(tinybars: bigint, rate: HbarRate): bigint {
  const numerator = tinybars * rate.centEquivalent;
  const denominator = rate.hbarEquivalent * TINYBARS_PER_HBAR;
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const rounded = (magnitude * 2n + denominator) / (denominator * 2n);
  return negative ? -rounded : rounded;
}

/** `$4.00`. Cents in, dollars out, with the sign in front of the symbol. */
export function formatCents(cents: bigint): string {
  const negative = cents < 0n;
  const magnitude = negative ? -cents : cents;
  const dollars = magnitude / 100n;
  const remainder = magnitude % 100n;
  return `${negative ? "-" : ""}$${dollars.toString()}.${remainder.toString().padStart(2, "0")}`;
}

/** What the screen shows for an amount, in dollars, at the network's rate. */
export function usdWords(tinybars: bigint, rate: HbarRate): string {
  return formatCents(tinybarsToCents(tinybars, rate));
}
