#!/usr/bin/env bash
# Prove the gate against the live Blocky402 testnet facilitator, without
# signing anything.
#
# What this exercises for real, over the network:
#   - /supported, because the fee payer in our 402 is discovered, not configured
#   - /verify, because a deliberately undecodable payment gets a real rejection
#
# What it cannot exercise: a valid payment. That needs an ECDSA signature from
# the requester, which is the client half and lives in apps/requester.
#
# Usage: pnpm start in one shell, then pnpm smoke in another.
set -uo pipefail

BASE="${SMOKE_BASE:-http://localhost:${PORT:-4099}}"

# requester_account_id is required, and the body is parsed before the gate now,
# so a body without it is a 400 and never reaches a 402. Taken from your own
# environment rather than defaulted to somebody's account: nothing is signed and
# nothing is settled here, but a script that names one dev's account as its
# default is a script that quietly tests their setup instead of yours.
SMOKE_REQUESTER="${SMOKE_REQUESTER:-${X402_PAYER_ACCOUNT_ID:-${HEDERA_ACCOUNT_ID:-}}}"
if [ -z "$SMOKE_REQUESTER" ]; then
  echo "set SMOKE_REQUESTER, X402_PAYER_ACCOUNT_ID or HEDERA_ACCOUNT_ID to an account id" >&2
  exit 1
fi

order='{"spec":"smoke","artifact_base64":"eA==","cert_tag":"cpa-us",
        "requester_account_id":"'"$SMOKE_REQUESTER"'",
        "price_hbar":"200","deadline":"2026-09-14T00:00:00Z",
        "claim_timeout_seconds":3600}'

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

if ! curl -sf "$BASE/health" >/dev/null; then
  echo "nothing answering on $BASE. Start it with: pnpm start" >&2
  exit 1
fi

say "health"
curl -s "$BASE/health"; echo

say "unpaid: expect 402, a feePayer from the live facilitator, and a fund lock to sign"
curl -s -D - -o /dev/null -X POST "$BASE/orders" \
  -H 'Content-Type: application/json' -d "$order" | grep -iE '^(HTTP|payment-required)'

say "the same 402, decoded — note fund_lock beside the x402 challenge"
curl -s -X POST "$BASE/orders" -H 'Content-Type: application/json' -d "$order" |
  python3 -m json.tool

say "undecodable payment: expect the facilitator's own reason, not ours"
# Echo back the requirements the server just quoted, the way a real client
# does. Sending anything else earns accepted_payment_requirements_mismatch
# from the facilitator before it ever looks at the transaction.
payment="$(curl -s -X POST "$BASE/orders" -H 'Content-Type: application/json' -d "$order" |
  python3 -c '
import base64, json, sys
requirements = json.load(sys.stdin)["accepts"][0]
print(base64.b64encode(json.dumps({
    "x402Version": 2, "scheme": "exact", "network": "hedera:testnet",
    "accepted": requirements, "payload": {"transaction": "AAAA"},
}).encode()).decode())
')"
curl -s -X POST "$BASE/orders" -H 'Content-Type: application/json' \
  -H "PAYMENT-SIGNATURE: $payment" -d "$order" |
  python3 -c 'import json,sys; print(json.load(sys.stdin).get("error"))'
