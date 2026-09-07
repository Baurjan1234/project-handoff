import { describe, expect, it } from "vitest";
import { parseAccountId } from "./accountId";

describe("parseAccountId", () => {
  it("accepts an account id and trims it", () => {
    expect(parseAccountId(" 0.0.12345 ")).toEqual({ ok: true, accountId: "0.0.12345" });
  });

  it("names the two things people paste instead, without repeating them", () => {
    const evm = "0x41bb7bf8263e66a49d7bee6796d836709ed24afc";
    const evmCheck = parseAccountId(evm);
    expect(evmCheck).toMatchObject({ ok: false, reason: expect.stringContaining("EVM address") });
    expect(JSON.stringify(evmCheck)).not.toContain(evm.slice(2, 14));

    const key = "ab".repeat(32);
    const keyCheck = parseAccountId(`0x${key}`);
    expect(keyCheck).toMatchObject({ ok: false, reason: expect.stringContaining("looks like a key") });
    expect(JSON.stringify(keyCheck)).not.toContain(key.slice(0, 12));
  });

  it("refuses everything else in one sentence", () => {
    for (const text of ["", "0.0.0", "0.0.", "12345", "0.1.2", "0.0.12a"]) {
      expect(parseAccountId(text)).toMatchObject({ ok: false });
    }
  });
});
