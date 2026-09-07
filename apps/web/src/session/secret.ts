/**
 * A private key, held so it cannot leak by accident.
 *
 * The threat this answers is incidental, not adversarial: a key that reaches
 * a `JSON.stringify` of state, an interpolated error message, a React
 * devtools panel, or a `console.log` on cutover night. A plain string spreads
 * into all of those. This holder keeps the text in a private field that
 * enumeration, spread, `structuredClone` and every stringification path miss,
 * and exposes it through exactly one call that spends the holder.
 *
 * What it does not do: zero memory. A JavaScript string cannot be wiped, so
 * the screen says "in memory only" and never says "erased".
 */

const WITHHELD = "[private key withheld]";

export class SecretUnavailable extends Error {
  constructor() {
    super("The key was already used or discarded. Paste it again.");
    this.name = "SecretUnavailable";
  }
}

export class SecretKey {
  #text: string | null;

  private constructor(text: string) {
    this.#text = text;
  }

  /** Wraps what was pasted. Trims whitespace and nothing else. */
  static fromInput(text: string): SecretKey {
    return new SecretKey(text.trim());
  }

  /**
   * The one read. Spends the holder: a second call throws. The callback is
   * synchronous so the string does not outlive the call in this module; what
   * the callback does with it is the callback's responsibility.
   */
  useOnce<T>(fn: (key: string) => T): T {
    const text = this.#text;
    if (text === null) throw new SecretUnavailable();
    this.#text = null;
    return fn(text);
  }

  /** Drop the text without reading it. Idempotent. */
  dispose(): void {
    this.#text = null;
  }

  get spent(): boolean {
    return this.#text === null;
  }

  toString(): string {
    return WITHHELD;
  }

  toJSON(): string {
    return WITHHELD;
  }

  [Symbol.toPrimitive](): string {
    return WITHHELD;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return WITHHELD;
  }
}

/**
 * Redacts any run of 32 or more hex characters. For messages the app did not
 * write, on the connect path only: an SDK or adapter error that quotes its
 * input would otherwise put the key on screen. Not for the sign path, where
 * 64-hex hashes are legitimate content.
 */
export function scrubHex(message: string): string {
  return message.replace(/[0-9a-fA-F]{32,}/g, "[withheld]");
}
