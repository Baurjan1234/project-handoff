/**
 * The connect screen, rendered to static markup for each state. The rules
 * live in `session/connect.ts` and are table-tested there; this proves the
 * words and attributes the recording depends on are in the HTML, and that
 * the key never is.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { assessConnect, describeConnectError, type ConnectAssessment } from "../session/connect";
import { describePrivateKey, type KeyShape } from "../session/keyShape";
import type { AccountLookup } from "../session/mirrorAccount";
import { ConnectCard, ConnectScreen, type KeyFieldKind } from "./ConnectScreen";

const ACCOUNT = "0.0.12345";
// A fabricated key. The bytes are a pattern, not a key to anything.
const FIXTURE = `3030020100300706052b8104000a04220420${"c7".repeat(32)}`;
const TAIL = FIXTURE.slice(-16);

const found: AccountLookup = {
  status: "found",
  accountId: ACCOUNT,
  keyType: "ECDSA_SECP256K1",
  publicKey: `02${"ef".repeat(32)}`,
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
  keyShape?: KeyShape | null;
  keyField?: KeyFieldKind;
  error?: string | null;
  notice?: string | null;
  busy?: boolean;
  assessment?: ConnectAssessment;
}) {
  const mode = over.mode ?? "testnet";
  const accountIdText = over.accountIdText ?? ACCOUNT;
  const lookup = over.lookup ?? null;
  const keyShape = over.keyShape === undefined ? describePrivateKey(FIXTURE) : over.keyShape;
  const assessment = over.assessment ?? assessConnect({ mode, accountIdText, keyShape, lookup });
  return renderToStaticMarkup(
    <ConnectCard
      mode={mode}
      accountIdText={accountIdText}
      assessment={assessment}
      lookup={lookup}
      lookupPending={over.lookupPending ?? false}
      keyShape={keyShape}
      keyField={over.keyField ?? "masked"}
      error={over.error ?? null}
      notice={over.notice ?? null}
      busy={over.busy ?? false}
      {...handlers}
    />,
  );
}

const keyInput = (html: string) => html.match(/<input[^>]*id="connect-private-key"[^>]*>/)?.[0] ?? "";

describe("ConnectCard on the mock", () => {
  it("asks for the account id only and says nothing is signed", () => {
    const html = card({ mode: "mock", keyShape: null });
    expect(html).toContain("Sign in as an expert");
    expect(html).toContain("MOCK CHAIN");
    expect(html).toContain("On the mock chain nothing is real.");
    expect(html).toContain("Nothing is signed here");
    expect(html).not.toContain("Hedera testnet account");
    expect(html).not.toContain("connect-private-key");
    expect(html).not.toContain("Private key");
    expect(html).toContain(`Continue as ${ACCOUNT}`);
    // The button is live. (Tailwind's `disabled:` variants are class names, not the attribute.)
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""/);
  });
});

describe("ConnectCard on testnet", () => {
  it("draws the key field as dots without making it a credential field, and never carries a value", () => {
    const html = card({ lookup: found, keyField: "masked" });
    const input = keyInput(html);
    expect(input).toContain('type="text"');
    expect(input).toMatch(/-webkit-text-security:\s*disc/);
    expect(input).not.toContain("value=");
    expect(input).toMatch(/autocomplete="off"/i);
    expect(input).toContain("data-1p-ignore");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("<form");
    expect(html).toContain("Hedera testnet");
    expect(html).not.toContain("MOCK");
  });

  it("falls back to a password field where the masking CSS is missing, still with no value", () => {
    const html = card({ lookup: found, keyField: "password" });
    const input = keyInput(html);
    expect(input).toContain('type="password"');
    expect(input).not.toContain("value=");
    expect(html.match(/type="password"/g)).toHaveLength(1);
  });

  it("prefills the id field only, and names the account on the button", () => {
    const html = card({ lookup: found });
    expect(html).toMatch(/id="connect-account-id"[^>]*value="0\.0\.12345"/);
    expect(html).not.toMatch(/id="connect-account-id"[^>]*inputmode=/i);
    expect(html).toContain(`Continue as ${ACCOUNT}`);
    expect(html).toContain(`hashscan.io/testnet/account/${ACCOUNT}`);
  });

  it("shows what the mirror node said: curve, balance, and each failure", () => {
    expect(card({ lookup: found })).toContain("Found on testnet");
    expect(card({ lookup: found })).toContain("ECDSA key · 1000 HBAR");
    expect(card({ lookupPending: true })).toContain("Checking testnet…");
    expect(card({ lookup: { status: "not-found", accountId: ACCOUNT } })).toContain("Not found on testnet");
    const deleted = card({ lookup: { ...found, deleted: true, balanceTinybars: "0" } });
    expect(deleted).toContain("Deleted on testnet");
    expect(deleted).not.toContain("Found on testnet");
    // No curve-and-balance line for a deleted account. (The key-shape line still says "ECDSA key.")
    expect(deleted).not.toContain("ECDSA key ·");
    expect(deleted).not.toContain("0 HBAR");
    const unreachable = card({ lookup: { status: "unreachable", accountId: ACCOUNT, reason: "HTTP 503" } });
    expect(unreachable).toContain("Testnet did not answer");
    expect(unreachable).toContain("Retry");
    // A DER key through an unreachable mirror node: warned, not blocked.
    expect(unreachable).toContain("the first signature will fail and say so");
    expect(unreachable).toContain(`Continue as ${ACCOUNT}`);
  });

  it("disables the button and lists why, in the expert's order", () => {
    const html = card({
      accountIdText: "",
      keyShape: null,
      assessment: assessConnect({ mode: "testnet", accountIdText: "", keyShape: null, lookup: null }),
    });
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>Continue<\/button>/);
    expect(html).toContain("Enter your account id, like 0.0.12345.");
    expect(html).toContain("Paste the private key of the account above.");
  });

  it("says what the key looks like, in words, once, and never the key", () => {
    const accepted = card({ lookup: found });
    expect(accepted).toContain("DER-encoded ECDSA key.");
    expect(accepted).not.toContain(TAIL);
    // (The class list mentions `aria-invalid:` variants; the attribute itself is absent.)
    expect(keyInput(accepted)).not.toContain('aria-invalid="true"');

    // A rejected shape: red under the field, marked invalid, and not repeated under the button.
    const rejected = card({ lookup: found, keyShape: describePrivateKey(ACCOUNT) });
    expect(rejected.match(/That is an account id, not a key\./g)).toHaveLength(1);
    expect(rejected).toMatch(/id="connect-key-shape"[^>]*text-destructive/);
    expect(keyInput(rejected)).toContain('aria-invalid="true"');
  });

  it("ties every hint and status to its field for assistive tech", () => {
    const html = card({ lookup: found });
    expect(html).toMatch(/id="connect-account-id"[^>]*aria-describedby="connect-account-help connect-account-status"/);
    expect(keyInput(html)).toContain('aria-describedby="connect-key-help connect-key-shape"');
    expect(html).toMatch(/id="connect-account-status"[^>]*role="status"/);
    expect(html).toContain('for="connect-private-key"');
    expect(html).not.toContain("aria-label=");
  });

  it("renders a failure in the app's words, with the key scrubbed if it was quoted", () => {
    const message = describeConnectError(new Error(`invalid private key: ${FIXTURE}`), ACCOUNT);
    const html = card({ lookup: found, error: message });
    expect(html).toContain("Not connected");
    expect(html).toContain("invalid private key: [withheld]");
    expect(html).not.toContain(TAIL);
  });

  it("carries the plain-language promises the demo makes", () => {
    const html = card({ lookup: found });
    expect(html).toContain("in memory only");
    expect(html).toContain("never a schedule key");
    expect(html).toContain("cannot touch the money in escrow");
    expect(html).toContain("Where do I find these?");
    expect(html).toContain('href="https://portal.hedera.com"');
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
    expect(html).toContain(`Continue as ${ACCOUNT}`);
    expect(html).not.toContain("connect-private-key");
  });

  it("starts on testnet waiting for the mirror node, with an empty key field", () => {
    // Static rendering runs no effects, so this is the state before the first read.
    const html = renderToStaticMarkup(
      <ConnectScreen mode="testnet" prefill={ACCOUNT} notice={null} onConnect={async () => ({ ok: true })} />,
    );
    expect(html).toContain("Checking testnet…");
    // React escapes the apostrophe in "testnet's"; match around it.
    expect(html).toContain("mirror node, its public read API, to confirm the account.");
    expect(keyInput(html)).not.toBe("");
    expect(keyInput(html)).not.toContain("value=");
  });
});
