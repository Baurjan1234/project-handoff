# Requester copy claims no check that did not run; NAS-36 closes with its scope moved

**Decision.** Three rulings on Tseegii's NAS-36 report, made together because they share
one cause: the product was about to say things it could not stand behind.

1. **"Certified" is banned on the requester's surface until a registry check runs.** The
   close reads "Signed by account 0.0.x · published forever" and "Credential claimed:
   {tag}. Not checked against a registry in this build." Tseegii's code change stands and
   `docs/design-system.md` is amended to match. Every time in a reply carries a zone,
   "18:00 UTC", for the same reason. The strings return to "certified" the day NAS-27
   ships a real check, and not before.
2. **NAS-36 closes.** The two failure replies that need the payer's key type and balance
   move to NAS-24, because only the requester side knows either. The "Claimed by …" reply
   cannot be built by anyone yet, because the schema has no claim message, so it moves to
   a new P4 issue for a claim envelope. What NAS-36 shipped is done: `handoff_status`,
   tag routing with an unknown tag refused before the fee settles, the unknown-tag reply,
   and the beat-3 copy.
3. **`handoff_status` reporting the verdict and the signing account is inside NAS-36**, not
   a step into NAS-37. NAS-37 keeps the full close: defect codes, notes, the money line.

**Why.** The attestations topic has no submit key, deliberately, because the expert signs
from their own account and a platform submit key would put us in the signing path. The
registry that would check the credential is NAS-27 and is not live. So any account can
publish an attestation-shaped message naming someone else's order, and the close was
presenting that to a paying requester as certified. Tseegii changed it without waiting,
which was right: the honesty rules in root `CLAUDE.md` already say certification is an
allowlist this week and the interface is all that exists. Copy that says "certified" in
front of a check that never ran is a marketing line contradicting a known limit, which is
exactly what those rules forbid.

Closing NAS-36 on work that can never happen in its lane would leave the board
describing something other than reality on check-in day. Moving the two payer-side
replies to NAS-24 puts them where the key and the balance are known. The missing claim
message is a real gap in the treaty: `packages/schema` has the order envelope and the
attestation, and `claim_timeout_seconds` on the order, but no message an expert
publishes when they claim. Without it there is no consensus timestamp to decide a
claim race, nothing for the claim window to anchor to, and no middle state for status.
That is P4's lane and a `breaking` PR to the schema.

**Consequences.**

- `docs/design-system.md`: two override rules added under the copy dictionary, the
  beat-2 and beat-3 strings drop "certified" and gain "UTC", the status strings drop
  "certified", the close gains the two-line signer form, and the inbox clock shows the
  zone. The Posted reply in `apps/mcp/src/replies.ts` still says "certified reviewer"
  and should follow in Tseegii's next PR.
- NAS-36 is Done. NAS-24 carries the two payer-side replies. A new P4 issue carries the
  claim envelope, announced at the sync as `breaking`.
- The claim envelope, once it exists, unblocks the claimed-state reply, the lost-race
  screen (NAS-26) and the claim window (NAS-39). Until then status goes from Posted to
  Signed and must not invent the middle state.
- NAS-27, the registry, is now the thing that lets the copy say "certified" again. That
  is a reason to keep it in Tier 1, not a reason to hurry it.
