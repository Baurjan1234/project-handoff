/**
 * The connect screen, rendered to static markup for each state. The rules
 * live in `session/connect.ts` and are table-tested there; this proves the
 * words and attributes the recording depends on are in the HTML, and that
 * the key never is.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { assessConnect, type ConnectAssessment } from "../session/connect";
import { describeKeyShape, describePrivateKey } from "../session/keyShape";
import type { AccountLookup } from "../session/mirrorAccount";
import { ConnectCard, ConnectScreen } from "./ConnectScreen";

const ACCOUNT = "0.0.12345";
// A fabricated key. The bytes are a pattern, not a key to anything.
const FIXTURE = `3030020100300706052b8104000a04220420${"c7".repeat(32)}`;

const found: AccountLookup = {
  status: "found",
  accountId: ACCOUNT,
  keyType: "ECDSA_SECP256K1",
  publicKey: `02${"ab".repeat(32)}`,
  balanceTinybars: "100000000000",
  deleted: false,
};

const handlers = {
  onAccountIdChange: () => {},
  onKeyChange: () => {},
  onRetryLookup: () => {},
  onConnect: () => {},
};

function card(over: {
  mode?: "mock" | "testnet";
  accountIdText?: string;
  lookup?: AccountLookup | null;
  lookupPending?: boolean;
  keyWords?: string | null;
  error?: string | null;
  notice?: string | null;
  busy?: boolean;
  assessment?: ConnectAssessment;
}) {
  const mode = over.mode ?? "testnet";
  const accountIdText = over.accountIdText ?? ACCOUNT;
  const lookup = over.lookup ?? null;
  const assessment =
    over.assessment ?? assessConnect({ mode, accountIdText, keyShape: describePrivateKey(FIXTURE), lookup });
  return renderToStaticMarkup(
    <ConnectCard
      mode={mode}
      accountIdText={accountIdText}
      assessment={assessment}
      lookup={lookup}
      lookupPending={over.lookupPending ?? false}
      keyWords={over.keyWords ?? null}
      error={over.error ?? null}
      notice={over.notice ?? null}
      busy={over.busy ?? false}
      {...handlers}
    />,
  );
}

describe("ConnectCard on the mock", () => {
  it("asks for the account id only and says nothing is signed", () => {
    const html = card({ mode: "mock" });
    expect(html).toContain("Connect your account");
    expect(html).toContain("MOCK CHAIN");
    expect(html).toContain("Nothing is signed here");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("Private key");
    expect(html).toContain(`Connect as ${ACCOUNT}`);
    // The button is live. (Tailwind's `disabled:` variants are class names, not the attribute.)
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""/);
  });
});

describe("ConnectCard on testnet", () => {
  it("has one password field that never carries a value, and never offers to save it", () => {
    const html = card({ lookup: found });
    const passwordFields = html.match(/type="password"/g) ?? [];
    expect(passwordFields).toHaveLength(1);
    expect(html).not.toMatch(/type="password"[^>]*value=/);
    // React renders the attribute in camel case; HTML attribute names are case-insensitive.
    expect(html).toMatch(/type="password"[^>]*autocomplete="off"/i);
    expect(html).toMatch(/type="password"[^>]*data-1p-ignore/);
    expect(html).not.toContain("<form");
    expect(html).toContain("Hedera testnet");
    expect(html).not.toContain("MOCK");
  });

  it("prefills the id field only, and names the account on the button", () => {
    const html = card({ lookup: found });
    expect(html).toMatch(/id="connect-account-id"[^>]*value="0\.0\.12345"/);
    expect(html).toContain(`Connect as ${ACCOUNT}`);
    expect(html).toContain(`hashscan.io/testnet/account/${ACCOUNT}`);
  });

  it("shows what the mirror node said: curve, balance, and each failure", () => {
    expect(card({ lookup: found })).toContain("Found on testnet");
    expect(card({ lookup: found })).toContain("ECDSA key · 1000 HBAR");
    expect(card({ lookupPending: true })).toContain("Checking testnet…");
    expect(card({ lookup: { status: "not-found", accountId: ACCOUNT } })).toContain("Not found on testnet");
    const unreachable = card({ lookup: { status: "unreachable", accountId: ACCOUNT, reason: "HTTP 503" } });
    expect(unreachable).toContain("Mirror node unreachable");
    expect(unreachable).toContain("Retry");
    // A DER key through an unreachable mirror node: warned, not blocked.
    expect(unreachable).toContain("the first signature will tell");
    expect(unreachable).toContain(`Connect as ${ACCOUNT}`);
  });

  it("disables the button and lists why, in the expert's order", () => {
    const html = card({ accountIdText: "", assessment: assessConnect({ mode: "testnet", accountIdText: "", keyShape: null, lookup: null }) });
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>Connect<\/button>/);
    expect(html).toContain("Enter your account id, like 0.0.12345.");
    expect(html).toContain("Paste the private key of the account above.");
  });

  it("says what the key looks like, in words, and never the key", () => {
    const words = describeKeyShape(describePrivateKey(FIXTURE));
    const html = card({ lookup: found, keyWords: words });
    expect(html).toContain("DER-encoded ECDSA key.");
    expect(html).not.toContain(FIXTURE.slice(-16));
  });

  it("renders a failure in the app's words, with the key scrubbed if it was quoted", () => {
    const html = card({ lookup: found, error: `invalid private key: [withheld]` });
    expect(html).toContain("Not connected");
    expect(html).toContain("invalid private key: [withheld]");
    expect(html).not.toContain(FIXTURE.slice(-16));
  });

  it("carries the plain-language promises the demo makes", () => {
    const html = card({ lookup: found });
    expect(html).toContain("in memory only");
    expect(html).toContain("never a schedule key");
    expect(html).toContain("cannot touch the money in escrow");
    expect(html).toContain("Where do I find these?");
    expect(html).toContain("Testnet only.");
    expect(html).toContain("wallet app signs instead");
  });

  it("shows the notice from the previous screen and the busy label", () => {
    expect(card({ notice: "Disconnected. Your attestation, if you published one, stands on the ledger." })).toContain(
      "stands on the ledger",
    );
    expect(card({ lookup: found, busy: true })).toContain("Connecting…");
  });
});

describe("ConnectScreen", () => {
  it("starts from the prefill on the mock and is ready in one click", () => {
    const html = renderToStaticMarkup(
      <ConnectScreen mode="mock" prefill={ACCOUNT} notice={null} onConnect={async () => ({ ok: true })} />,
    );
    expect(html).toContain(`Connect as ${ACCOUNT}`);
    expect(html).not.toContain('type="password"');
  });

  it("starts on testnet waiting for the mirror node, with an empty key field", () => {
    const html = renderToStaticMarkup(
      <ConnectScreen
        mode="testnet"
        prefill={ACCOUNT}
        notice={null}
        onConnect={async () => ({ ok: true })}
        lookup={async () => found}
      />,
    );
    expect(html).toContain("Checking testnet…");
    expect(html).toContain("Waiting for the mirror node to confirm the account.");
    expect(html).toMatch(/type="password"/);
    expect(html).not.toMatch(/type="password"[^>]*value=/);
  });
});
