import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConnectCard } from "./ConnectScreen";
import { expectNoBannedWords } from "./fixtures";

const base = {
  lookupPending: false,
  keyShape: null,
  keyField: "masked" as const,
  error: null,
  notice: null,
  busy: false,
  onAccountIdChange: () => {},
  onKeyChange: () => {},
  onRetryLookup: () => {},
  onConnect: () => {},
};
const assessment = (accountId: string | null, ready: boolean) => ({
  accountId,
  blockers: ready ? [] : ["Enter your account id, like 0.0.12345."],
  warnings: [],
  keyType: null,
  ready,
});
const found = {
  status: "found" as const,
  accountId: "0.0.12345",
  keyType: "ECDSA_SECP256K1" as const,
  publicKey: "02ab",
  balanceTinybars: "100000000000",
  deleted: false,
};
const credential = { label: "Certified Accountant", tag: "cert:accounting-cpa" };

describe("the sign-in card", () => {
  it("leads with Sign in, then the divider, then the collapsed Hedera panel", () => {
    const html = renderToStaticMarkup(
      <ConnectCard {...base} mode="testnet" accountIdText="" assessment={assessment(null, false)} lookup={null} credential={credential} />,
    );
    expect(html).toContain("Sign in as an expert");
    expect(html).toContain("Review work, sign your verdict, get paid.");
    expect(html).toContain("Sign in with your email to start reviewing.");
    expect(html).toContain("or bring your own key");
    expect(html).toContain("Connect with your Hedera account");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("grid-rows-[0fr]");
    expect(html).toContain('inert=""');
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("opens the panel when an id is already there, and hides the credential until the network found it", () => {
    const typing = renderToStaticMarkup(
      <ConnectCard {...base} mode="testnet" accountIdText="0.0.123" assessment={assessment(null, false)} lookup={null} credential={credential} />,
    );
    expect(typing).toContain('aria-expanded="true"');
    // The panel is open; the credential slot is the collapsed one.
    expect(typing).toContain("grid-rows-[1fr]");
    expect(typing).toContain("grid-rows-[0fr]");
    // The card's markup is present so it can grow in; the slot is collapsed
    // and aria-hidden, so nothing reads it out.

    const confirmed = renderToStaticMarkup(
      <ConnectCard {...base} mode="testnet" accountIdText="0.0.12345" assessment={assessment("0.0.12345", false)} lookup={found} credential={credential} />,
    );
    expect(confirmed).toContain("Certified Accountant");
    expect(confirmed).toContain("cert:accounting-cpa");
    expect(confirmed).toContain("grid-rows-[1fr]");
    expect(confirmed).not.toContain("grid-rows-[0fr]");
  });

  it("shows the credential on the mock as soon as the id parses, and no key field", () => {
    const html = renderToStaticMarkup(
      <ConnectCard {...base} mode="mock" accountIdText="0.0.12345" assessment={assessment("0.0.12345", true)} lookup={null} credential={credential} />,
    );
    expect(html).toContain("Certified Accountant");
    expect(html).not.toContain("connect-private-key");
    expect(html).toContain("Continue as 0.0.12345");
  });

  it("still says the key rules, and still names a rejected key without printing it", () => {
    const html = renderToStaticMarkup(
      <ConnectCard
        {...base}
        mode="testnet"
        accountIdText="0.0.12345"
        assessment={assessment("0.0.12345", false)}
        lookup={found}
        keyShape={{ ok: false, reason: "invalid private key: [withheld]" }}
        credential={credential}
      />,
    );
    expect(html).toContain("in memory only");
    expect(html).toContain("cannot touch the money in escrow");
    expect(html).toContain("invalid private key: [withheld]");
  });
});
