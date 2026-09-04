/**
 * Money.
 *
 * Tinybars as `bigint` internally, strings at every boundary. This is the only
 * module in the repository that converts between units. If you find yourself
 * writing `/ 100000000` anywhere else, stop and import from here.
 *
 * A float can represent 0.1 + 0.2 as 0.30000000000000004. An escrow that does
 * that is a bug that costs somebody money, so `number` never appears below.
 */

export const TINYBARS_PER_HBAR = 100_000_000n;
export const HBAR_DECIMALS = 8;

/** Hedera amounts travel as int64. Anything outside this cannot be submitted. */
export const MAX_TINYBARS = 9_223_372_036_854_775_807n;
export const MIN_TINYBARS = -9_223_372_036_854_775_808n;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/** Wire format for tinybars: an optionally signed integer, no leading zeros. */
const TINYBAR_STRING = /^-?(?:0|[1-9]\d*)$/;

/** Human format for HBAR: an optionally signed decimal, no leading zeros, no exponent. */
const HBAR_STRING = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function assertInRange(tinybars: bigint): bigint {
  if (tinybars > MAX_TINYBARS || tinybars < MIN_TINYBARS) {
    throw new MoneyError(`tinybar amount outside int64: ${tinybars.toString()}`);
  }
  return tinybars;
}

/** An order price, a payout, a fee. Zero is not a price. */
export function assertPositive(tinybars: bigint): bigint {
  if (tinybars <= 0n) {
    throw new MoneyError(`amount must be positive, got ${tinybars.toString()}`);
  }
  return assertInRange(tinybars);
}

/** Parse the wire form. Rejects anything a lenient parser would silently accept. */
export function parseTinybars(value: string): bigint {
  if (typeof value !== "string" || !TINYBAR_STRING.test(value)) {
    throw new MoneyError(`not a tinybar integer string: ${JSON.stringify(value)}`);
  }
  return assertInRange(BigInt(value));
}

/** Render the wire form. This is what crosses a boundary, never a bigint. */
export function formatTinybars(value: bigint): string {
  return assertInRange(value).toString();
}

/**
 * Parse a human HBAR amount into tinybars.
 *
 * More than eight decimal places is an error rather than a rounding, because
 * silently discarding somebody's money is worse than refusing their input.
 */
export function hbarToTinybars(hbar: string): bigint {
  if (typeof hbar !== "string" || !HBAR_STRING.test(hbar)) {
    throw new MoneyError(`not an HBAR decimal string: ${JSON.stringify(hbar)}`);
  }

  const negative = hbar.startsWith("-");
  const unsigned = negative ? hbar.slice(1) : hbar;
  const dot = unsigned.indexOf(".");
  const whole = dot === -1 ? unsigned : unsigned.slice(0, dot);
  const fraction = dot === -1 ? "" : unsigned.slice(dot + 1);

  if (fraction.length > HBAR_DECIMALS) {
    throw new MoneyError(
      `${hbar} has more precision than a tinybar; the limit is ${HBAR_DECIMALS} decimal places`,
    );
  }

  const magnitude =
    BigInt(whole) * TINYBARS_PER_HBAR + BigInt(fraction.padEnd(HBAR_DECIMALS, "0"));

  return assertInRange(negative ? -magnitude : magnitude);
}

/** Render tinybars as a canonical HBAR decimal string, trailing zeros trimmed. */
export function tinybarsToHbar(tinybars: bigint): string {
  assertInRange(tinybars);

  const negative = tinybars < 0n;
  const magnitude = negative ? -tinybars : tinybars;
  const whole = magnitude / TINYBARS_PER_HBAR;
  const fraction = magnitude % TINYBARS_PER_HBAR;

  let out = whole.toString();
  if (fraction > 0n) {
    out += `.${fraction.toString().padStart(HBAR_DECIMALS, "0").replace(/0+$/, "")}`;
  }

  return negative ? `-${out}` : out;
}

/** For a screen or a narration. Never for arithmetic, never for comparison. */
export function tinybarsToDisplay(tinybars: bigint): string {
  return `${tinybarsToHbar(tinybars)} HBAR`;
}
