/**
 * Does X402Signer's payload survive contact with the real Blocky402 facilitator?
 *
 * Not the same question as "does the paid request work" — that needs a funded ECDSA
 * payer and the resource server, and it is NAS-16 / P2's smoke-402.sh. This asks the
 * narrower question that can be answered today with no credentials at all: **is the
 * wire shape one the facilitator parses and reasons about, or does it bounce before
 * it is even looked at?**
 *
 * The payer here is a freshly generated ECDSA key with no account behind it, so a
 * rejection is expected. What matters is WHICH rejection. "invalid signature",
 * "account does not exist" or "insufficient balance" all mean the envelope parsed
 * and the facilitator got as far as the transaction. A schema or version complaint
 * would mean the shape is wrong and P2's next PR would have found it the hard way.
 *
 * Run: node --env-file=../../.env $(which npx) tsx scripts/probe-x402-wire.ts
 */
import { PrivateKey } from "@hiero-ledger/sdk";
import { X402Signer } from "../src/x402-signer.ts";

// `??` is wrong here: these are blank-not-absent in .env, and "" is not null.
const or = (value: string | undefined, fallback: string): string => (value?.trim() ? value.trim() : fallback);
const FACILITATOR = or(process.env["X402_FACILITATOR_URL"], "https://api.testnet.blocky402.com");
// 0.5 HBAR, committed in docs/decisions/2026-09-06-demo-price-and-x402-fee.md.
const FEE_TINYBARS = or(process.env["X402_FEE_TINYBARS"], "50000000");

async function main(): Promise<void> {
  // 1. Ask the facilitator who it co-signs as, the same way the resource server does at boot.
  const supported = (await (await fetch(`${FACILITATOR}/supported`)).json()) as {
    kinds: { network: string; scheme: string; x402Version: number; extra?: { feePayer?: string } }[];
  };
  const hedera = supported.kinds.find((k) => k.network === "hedera:testnet");
  if (!hedera?.extra?.feePayer) {
    throw new Error("the facilitator advertises no hedera:testnet fee payer");
  }
  console.log(`facilitator fee payer for hedera:testnet: ${hedera.extra.feePayer}`);
  console.log(`scheme: ${hedera.scheme}, x402Version: ${hedera.x402Version}`);

  // 2. Build a payload. Uses the real funded payer from .env when it is there, and
  // falls back to a throwaway key with no account behind it — which still answers the
  // wire-shape question, just with a guaranteed rejection at precheck.
  const envPayerId = process.env["X402_PAYER_ACCOUNT_ID"]?.trim();
  const envPayerKey = process.env["X402_PAYER_PRIVATE_KEY"]?.trim();
  const real = Boolean(envPayerId && envPayerKey);

  const payerAccountId = real ? (envPayerId as string) : "0.0.999999999";
  const payerKey = real ? PrivateKey.fromString(envPayerKey as string) : PrivateKey.generateECDSA();
  console.log(`\npayer: ${payerAccountId} ${real ? "(real, from .env)" : "(throwaway, no account behind it)"}`);

  const signer = new X402Signer({
    accountId: payerAccountId,
    resourceUrl: "http://localhost:8402/orders",
    privateKey: payerKey,
    maxAmountTinybars: FEE_TINYBARS,
  });

  const payload = await signer.sign({
    scheme: hedera.scheme,
    network: "hedera:testnet",
    amount: FEE_TINYBARS,
    // The real receiver when we have one. This probe calls /verify only, never
    // /settle, so no money moves either way.
    payTo: or(process.env["X402_RECEIVER_ACCOUNT_ID"], "0.0.98"),
    maxTimeoutSeconds: 60,
    asset: "0.0.0",
    extra: { feePayer: hedera.extra.feePayer },
  });

  console.log(`\nsigner produced a payload: ${payload.length} base64 chars`);
  const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as Record<string, unknown>;
  console.log(`decoded envelope keys: ${Object.keys(decoded).join(", ")}`);

  // 3. Hand it to the real /verify and read what comes back.
  const response = await fetch(`${FACILITATOR}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      x402Version: 2,
      paymentPayload: decoded,
      paymentRequirements: {
        scheme: hedera.scheme,
        network: "hedera:testnet",
        amount: FEE_TINYBARS,
        payTo: or(process.env["X402_RECEIVER_ACCOUNT_ID"], "0.0.98"),
        maxTimeoutSeconds: 60,
        asset: "0.0.0",
        extra: { feePayer: hedera.extra.feePayer },
      },
    }),
  });

  const body = await response.text();
  console.log(`\n/verify → HTTP ${response.status}`);
  console.log(body.slice(0, 600));

  console.log(`\n--- how to read this ---`);
  console.log(`A complaint about the SIGNATURE, the ACCOUNT or the BALANCE means the`);
  console.log(`envelope parsed and the wire shape is right — the only thing missing is a`);
  console.log(`funded ECDSA account. A complaint about the SCHEMA, VERSION or a missing`);
  console.log(`field means the shape is wrong and needs fixing before NAS-16.`);
}

main().catch((error: unknown) => {
  console.error("\n=== PROBE FAILED ===");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
