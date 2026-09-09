# World Selfie Check: go, but after the Sep 11 freeze

**Decision.** The Sep 9 gate passes. World ID Selfie Check integration proceeds as a
**post-freeze parallel track** from Sep 11–13, alongside demo polish. It does not touch
the main flow until the base submission is safe.

**Why go.** The x402 gate is green, the first real paid request ran on testnet Sep 8,
and 422 tests pass. The core Tier 1 scope is built. The prize pool ($1,166 per team, up
to three) is modest but the fit is genuine: gating attestation signing on proof of
personhood is exactly the "risk, eligibility, fairness or abuse-prevention signal" the
prize page asks for. It is worth a focused two-day attempt.

**Why post-freeze, not now.** The recording milestone (NAS-29) and check-in 2 (NAS-30)
are not done. World ID integration touches the expert app's sign flow, which is on
camera. Mixing it into the pre-freeze work risks breaking a demo that already works. The
base submission must exist before any stretch goal is attempted.

**The plan: divide and conquer after Sep 11.**

- **Track A (whoever is free):** Demo polish. Clean up the main flow, improve UI
  feeling, brand assets into the system, make the Hackathon demo as tight as possible.
- **Track B (dedicated person):** World ID Selfie Check integration. Collect everything
  needed from the World partner team, wire the selfie check into the expert sign flow,
  test against the sandbox. If it ships, it ships alongside the base submission. If it
  doesn't, the base submission stands on its own.

Track A is the priority. Track B is upside. Neither blocks the other.

**Before starting Track B, collect from the World partner team:**

1. Sandbox access approval status (requested on Sep 5)
2. The app ID and action ID for the Selfie Check credential
3. Whether the sandbox simulates staging proofs without a physical Orb
4. Any test credentials or mock verification flows available
5. The feedback document template, if one exists — writing it is a qualification
   requirement

**Where it goes: sign time, not claim time.** Unchanged from the original gate decision.
The attestation is the artifact backed by a live human, so the selfie check binds to the
moment of signing.

**What we say on camera.** Selfie Check proves a live human was present. It does not
prove that human read the artifact. It kills the bot rubber-stamp. The lazy-human
rubber-stamp stays, and we say so. m-of-n jury plus bonds remains the production answer.

**Consequences.**

- Supersedes `2026-09-05-world-selfie-check-gated.md`: the gate is resolved, the answer
  is go.
- World ID moves from Tier 3 to **Tier 2**, as the original gate decision anticipated.
- World documentation can now enter the shared notebook.
- Build issues for the integration are created on the board after Sep 11, not before.
- The brief's Known Limits section is unchanged — if World ID ships, the "certification
  is an allowlist" limit gets a footnote, not a removal.

**Supersedes.** `2026-09-05-world-selfie-check-gated.md` (the gate itself).
