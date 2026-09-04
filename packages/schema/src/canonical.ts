/**
 * Canonical serialization and hashing.
 *
 * Two independent implementations must produce the same hash from the same
 * logical value, or the on-chain commitment means nothing. That rules out
 * `JSON.stringify` on its own, whose output depends on insertion order.
 *
 * The rules here are deliberately narrow. Anything ambiguous is rejected
 * rather than guessed at, because a hash that is merely usually right is
 * worse than one that refuses to be computed.
 */

import { createHash } from "node:crypto";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export class CanonicalizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalizeError";
  }
}

const utf8 = new TextEncoder();

/** Byte length, which is what HCS limits, not character count. */
export function byteLength(value: string): number {
  return utf8.encode(value).length;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

function write(value: unknown, path: string, out: string[]): void {
  if (value === null) {
    out.push("null");
    return;
  }

  switch (typeof value) {
    case "string":
      // Well-formed JSON.stringify escapes lone surrogates, so the output is
      // always valid UTF-8 and stable across engines.
      out.push(JSON.stringify(value));
      return;

    case "boolean":
      out.push(value ? "true" : "false");
      return;

    case "number":
      if (!Number.isFinite(value)) {
        throw new CanonicalizeError(`${path}: ${String(value)} has no JSON representation`);
      }
      if (!Number.isInteger(value)) {
        throw new CanonicalizeError(
          `${path}: ${value} is not an integer. Fractional values are ambiguous once hashed; ` +
            `carry them as strings, and carry money as tinybar strings.`,
        );
      }
      if (!Number.isSafeInteger(value)) {
        throw new CanonicalizeError(`${path}: ${value} is beyond the safe integer range`);
      }
      out.push(value.toString());
      return;

    case "bigint":
      throw new CanonicalizeError(
        `${path}: a bigint cannot be hashed directly. Format it to a string first, ` +
          `via the money module if it is an amount.`,
      );

    case "undefined":
      throw new CanonicalizeError(
        `${path}: undefined has no JSON representation. Omit the key instead.`,
      );

    case "function":
    case "symbol":
      throw new CanonicalizeError(`${path}: cannot hash a ${typeof value}`);

    case "object":
      break;
  }

  const obj = value as object;

  if (Array.isArray(obj)) {
    out.push("[");
    obj.forEach((item, index) => {
      if (index > 0) out.push(",");
      write(item, `${path}[${index}]`, out);
    });
    out.push("]");
    return;
  }

  if (!isPlainObject(obj)) {
    throw new CanonicalizeError(
      `${path}: only plain objects and arrays can be hashed, got ${obj.constructor?.name ?? "an exotic object"}`,
    );
  }

  // Sorted by UTF-16 code unit, matching RFC 8785, so key insertion order
  // cannot change the hash.
  const keys = Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  out.push("{");
  keys.forEach((key, index) => {
    if (index > 0) out.push(",");
    out.push(JSON.stringify(key), ":");
    write((obj as Record<string, unknown>)[key], `${path}.${key}`, out);
  });
  out.push("}");
}

/** Deterministic JSON: sorted keys, no whitespace, no ambiguous values. */
export function canonicalize(value: unknown): string {
  const out: string[] = [];
  write(value, "$", out);
  return out.join("");
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** The hash that goes on-chain. Canonical bytes in, 64 hex characters out. */
export function hashCanonical(value: unknown): string {
  return sha256Hex(utf8.encode(canonicalize(value)));
}
