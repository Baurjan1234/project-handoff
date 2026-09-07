import { describe, expect, it } from "vitest";
import { scrubHex, SecretKey, SecretUnavailable } from "./secret";

// What Node's util.inspect calls, without importing node:util into a browser build.
function inspect(value: object): string {
  const custom = (value as Record<symbol, (() => string) | undefined>)[Symbol.for("nodejs.util.inspect.custom")];
  return custom === undefined ? "(no inspect hook)" : custom.call(value);
}

// A fabricated key. The bytes are a pattern, not a key to anything.
const FIXTURE = `3030020100300706052b8104000a04220420${"c7".repeat(32)}`;
const TAIL = FIXTURE.slice(-16);

describe("SecretKey", () => {
  it("gives the text to exactly one reader, then is spent", () => {
    const key = SecretKey.fromInput(`  ${FIXTURE}\n`);
    expect(key.spent).toBe(false);
    expect(key.useOnce((text) => text)).toBe(FIXTURE);
    expect(key.spent).toBe(true);
    expect(() => key.useOnce((text) => text)).toThrow(SecretUnavailable);
  });

  it("can be discarded unread, and stays discarded", () => {
    const key = SecretKey.fromInput(FIXTURE);
    key.dispose();
    key.dispose();
    expect(key.spent).toBe(true);
    expect(() => key.useOnce((text) => text)).toThrow(/Paste it again/);
  });

  it("never appears through any stringification or enumeration path", () => {
    const key = SecretKey.fromInput(FIXTURE);
    const renderings = [
      String(key),
      `${key}`,
      key + "",
      JSON.stringify({ key }),
      JSON.stringify(key),
      inspect(key),
      JSON.stringify(Object.keys(key)),
      JSON.stringify({ ...key }),
      JSON.stringify(Object.getOwnPropertyNames(key)),
      JSON.stringify(structuredClone(key)),
    ];
    for (const rendering of renderings) {
      expect(rendering).not.toContain(TAIL);
    }
    expect(String(key)).toBe("[private key withheld]");
    // Still intact after all of that.
    expect(key.useOnce((text) => text)).toBe(FIXTURE);
  });

  it("does not put the key in the error that says it is gone", () => {
    const key = SecretKey.fromInput(FIXTURE);
    key.useOnce(() => undefined);
    let message = "";
    try {
      key.useOnce(() => undefined);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain(TAIL);
  });
});

describe("scrubHex", () => {
  it("redacts long hex runs, in any case, with or without 0x", () => {
    expect(scrubHex(`bad key: ${FIXTURE}`)).toBe("bad key: [withheld]");
    expect(scrubHex(`0x${FIXTURE.toUpperCase()} rejected`)).toBe("0x[withheld] rejected");
  });

  it("leaves short ids and ordinary words alone", () => {
    expect(scrubHex("account 0.0.12345 not found; deadbeef")).toBe("account 0.0.12345 not found; deadbeef");
  });
});
