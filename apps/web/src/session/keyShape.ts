/**
 * What a pasted private key looks like, without touching it as a key.
 *
 * This app never imports the Hedera SDK, so it cannot parse a key, derive a
 * public key, or check that the key matches the account. It can tell whether
 * the text has the shape of a key, so an expert who pasted the wrong thing
 * (an account id, a public key, a mnemonic) learns that before the sign
 * action does. The real check is the network's: a message signed with the
 * wrong key is rejected at submit, and that error is surfaced as is.
 *
 * Shapes, per Hedera's own docs (native/keys/import-key, native/quickstart):
 *   - DER, as the developer portal shows it. ED25519 keys start with
 *     302e020100300506032b657004220420 and are 96 hex characters; ECDSA
 *     secp256k1 keys start with 3030020100300706052b8104000a04220420 and are
 *     100 hex characters. The prefix names the curve.
 *   - Raw: the 64-hex scalar alone, with or without 0x. The SDK accepts it
 *     through fromStringECDSA / fromStringED25519; the curve is not in the
 *     text, so it is the adapter's to decide.
 *
 * The functions here return the shape and never the key. Nothing in this
 * module keeps a reference to the text after it returns.
 */

export type KeyCurve = "ED25519" | "ECDSA_SECP256K1";

export type KeyShape =
  | { readonly ok: true; readonly encoding: "der"; readonly curve: KeyCurve }
  | { readonly ok: true; readonly encoding: "raw"; readonly curve: null }
  | { readonly ok: false; readonly reason: string };

const DER_ED25519_PREFIX = "302e020100300506032b657004220420";
const DER_ECDSA_PREFIX = "3030020100300706052b8104000a04220420";
const SCALAR_HEX_CHARS = 64;

const HEX = /^[0-9a-f]+$/;

export function describePrivateKey(text: string): KeyShape {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, reason: "Paste the private key of the account above." };

  if (trimmed.startsWith("-----BEGIN")) {
    return { ok: false, reason: "That is a PEM file. Paste the hex string from the portal instead." };
  }
  if (/^0\.0\.\d+$/.test(trimmed)) {
    return { ok: false, reason: "That is an account id, not a key." };
  }
  if (/\s/.test(trimmed)) {
    return { ok: false, reason: "A key has no spaces. A list of words is a recovery phrase, not the key itself." };
  }

  const hex = (trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed.slice(2) : trimmed).toLowerCase();
  if (!HEX.test(hex)) {
    return { ok: false, reason: "A key is hexadecimal: digits and the letters a to f only." };
  }

  if (hex.startsWith(DER_ED25519_PREFIX) && hex.length === DER_ED25519_PREFIX.length + SCALAR_HEX_CHARS) {
    return { ok: true, encoding: "der", curve: "ED25519" };
  }
  if (hex.startsWith(DER_ECDSA_PREFIX) && hex.length === DER_ECDSA_PREFIX.length + SCALAR_HEX_CHARS) {
    return { ok: true, encoding: "der", curve: "ECDSA_SECP256K1" };
  }
  if (hex.length === SCALAR_HEX_CHARS) {
    return { ok: true, encoding: "raw", curve: null };
  }

  // A public key from the portal is DER too, but longer (302a… / 3036…) and
  // never carries the private scalar. Say so rather than "wrong length".
  if (hex.startsWith("302a") || hex.startsWith("3036")) {
    return { ok: false, reason: "That is a public key. The private key is the one the portal warns you to keep secret." };
  }
  return {
    ok: false,
    reason: `Expected 64 hex characters, or a DER key of 96 or 100. This has ${hex.length}.`,
  };
}

/** For the screen: what the shape says about the key, in words, never the key. */
export function describeKeyShape(shape: KeyShape): string {
  if (!shape.ok) return shape.reason;
  if (shape.encoding === "raw") return "Raw key. The curve is not in the text; the adapter decides.";
  return shape.curve === "ECDSA_SECP256K1" ? "DER-encoded ECDSA key." : "DER-encoded ED25519 key.";
}
