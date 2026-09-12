import { describe, expect, it } from "vitest";
import { parseCertTags, ConfigError } from "./config.js";
import {
  claimedReply,
  clockTime,
  deliveredReply,
  insufficientBalanceReply,
  postedReply,
  unknownTagReply,
  waitingReply,
  wrongKeyTypeReply,
} from "./replies.js";

const TAGS = [
  { code: "cpa-us", label: "Licensed reviewer" },
  { code: "sec-audit", label: "Security auditor" },
];

const DEADLINE = "2026-09-14T18:00:00Z";
const PRICE = "10000000000"; // 100 HBAR
const FEE = "50000000"; // 0.5 HBAR
const FEE_TX = "0.0.5551234@1757600000.000000001";
const LOCK_TX = "0.0.5551234@1757600002.000000002";

describe("clocks are times, never countdowns", () => {
  it("renders the deadline as an hour, labelled with its zone", () => {
    // The design system writes "18:00". The zone is ours: the deadline is a
    // UTC instant and the requester is not promised to be in UTC.
    expect(clockTime(DEADLINE)).toBe("18:00 UTC");
  });

  it("hands back an unparseable instant rather than inventing a time", () => {
    expect(clockTime("not a date")).toBe("not a date");
  });
});

describe("beat 3, posted", () => {
  const reply = postedReply({
    orderId: "ord_abc",
    priceTinybars: PRICE,
    deadline: DEADLINE,
    certTagLabel: "Licensed reviewer",
    feeTinybars: FEE,
  });

  it("puts the fee proof row first and the escrow line second", () => {
    const lines = reply.split("\n");
    expect(lines[0]).toBe("Service fee settled · 0.5 HBAR · settlement id not returned");
    expect(reply.indexOf("Service fee settled")).toBeLessThan(reply.indexOf("locked in escrow"));
  });

  it("never adds the two rails into one figure", () => {
    // "paid 100.5 HBAR" is the single most misleading thing this surface
    // could say: two rails, two accounts, two sizes.
    expect(reply).toContain("100 HBAR locked in escrow");
    expect(reply).toContain("0.5 HBAR");
    expect(reply).not.toContain("100.5");
  });

  it("says what unlocks the lock, because 'locked' alone reads as gone", () => {
    expect(reply).toContain("pays the reviewer when they sign, whatever the verdict");
    expect(reply).toContain("If nobody claims it by 18:00 UTC, it returns to you.");
  });

  it("names who can see it and that it cannot be taken back", () => {
    expect(reply).toContain("Visible to reviewers holding: Licensed reviewer");
    expect(reply).toContain("Cannot be cancelled once posted");
  });

  it("says the fee did not land rather than implying it did", () => {
    const unsettled = postedReply({
      orderId: "ord_abc",
      priceTinybars: PRICE,
      deadline: DEADLINE,
      certTagLabel: "Licensed reviewer",
      feeError: "the facilitator timed out",
    });

    expect(unsettled).toContain("Service fee not settled");
    expect(unsettled).toContain("the facilitator timed out");
    // The order still posted, so the order line is still there.
    expect(unsettled).toContain("Order posted · #ord_abc");
  });

  it("carries both transaction ids, one on each proof row", () => {
    const withIds = postedReply({
      orderId: "ord_abc",
      priceTinybars: PRICE,
      deadline: DEADLINE,
      certTagLabel: "Licensed reviewer",
      feeTinybars: FEE,
      feeTransactionId: FEE_TX,
      fundLockTransactionId: LOCK_TX,
    });
    const lines = withIds.split("\n");

    // The settle id is the only proof the fee was settled rather than merely
    // verified, and the lock id is what a requester opens to see their money.
    expect(lines[0]).toBe(`Service fee settled · 0.5 HBAR · tx ${FEE_TX}`);
    expect(withIds).toContain(`Lock tx ${LOCK_TX}`);
    // Still two rails, still not one figure.
    expect(withIds).not.toContain("100.5");
  });

  it("names a missing settlement id rather than going quiet about it", () => {
    // The facilitator can report success and return no transaction, and the
    // server then sends an empty string rather than omitting the field. Saying
    // only "settled" would read exactly like a settlement somebody can check.
    expect(reply).toContain("Service fee settled · 0.5 HBAR · settlement id not returned");
    expect(reply).not.toContain("tx 0.0.");
    expect(reply).not.toContain("Lock tx");
  });
});

describe("the wait", () => {
  it("answers with a time, once", () => {
    expect(waitingReply(DEADLINE)).toBe(
      "Posted · waiting for a certified reviewer. Open until 18:00 UTC.",
    );
  });

  it("names the claimant's account and their window, in the design system's words", () => {
    expect(claimedReply({ claimedBy: "0.0.777", signBy: "2026-09-14T18:12:00Z" })).toBe(
      "Claimed by account 0.0.777 · under review · sign by 18:12 UTC.",
    );
  });

  it("never calls the claimant certified, because nothing checked that", () => {
    // Same limit as the signed line: the cert tag on a claim is asserted by
    // the claimant and no registry checks it.
    const reply = claimedReply({ claimedBy: "0.0.777", signBy: "2026-09-14T18:12:00Z" });
    expect(reply).not.toContain("certified");
  });
});

describe("first-contact failures", () => {
  it("all end 'Nothing was charged.'", () => {
    const replies = [
      unknownTagReply("cpa-uk", TAGS),
      wrongKeyTypeReply("0.0.10376667", "ED25519"),
      insufficientBalanceReply("4200000000", FEE, PRICE),
    ];

    for (const reply of replies) {
      expect(reply.endsWith("Nothing was charged.")).toBe(true);
    }
  });

  it("names credentials in the words a person chose, not the code", () => {
    const reply = unknownTagReply("cpa-uk", TAGS);
    expect(reply).toContain('No reviewer holds the credential "cpa-uk"');
    expect(reply).toContain("Available: Licensed reviewer, Security auditor");
  });

  it("names the key type, which is what the facilitator would not have told them", () => {
    expect(wrongKeyTypeReply("0.0.10376667", "ED25519")).toBe(
      "Your account 0.0.10376667 uses an ED25519 key. The service fee needs an ECDSA account. " +
        "Nothing was charged.",
    );
  });

  it("gives both amounts separately, never their sum", () => {
    const reply = insufficientBalanceReply("4200000000", FEE, PRICE);
    expect(reply).toContain("holds 42 HBAR");
    expect(reply).toContain("0.5 HBAR for the fee");
    expect(reply).toContain("100 HBAR for escrow");
    expect(reply).not.toContain("100.5");
  });
});

describe("parseCertTags", () => {
  it("reads code=Label pairs in order", () => {
    expect(parseCertTags("cpa-us=Licensed reviewer, sec-audit=Security auditor")).toEqual(TAGS);
  });

  it("refuses an entry that is not code=Label", () => {
    expect(() => parseCertTags("cpa-us")).toThrow(ConfigError);
    expect(() => parseCertTags("=Licensed reviewer")).toThrow(ConfigError);
    expect(() => parseCertTags("cpa-us=")).toThrow(ConfigError);
  });

  it("refuses an empty list, because an order has to route somewhere", () => {
    expect(() => parseCertTags("  ")).toThrow(/route somewhere/);
  });

  it("refuses a repeated code, because routing would be ambiguous", () => {
    expect(() => parseCertTags("cpa-us=One, cpa-us=Two")).toThrow(/repeats a code/);
  });
});

describe("the close says only what was checked", () => {
  it("never calls the signer certified, because nothing checked that", () => {
    const reply = deliveredReply({ verdict: "reject", signedBy: "0.0.5", certTag: "cpa-us" });

    // The attestations topic has no submit key, on purpose, and the registry
    // that would verify a credential is not live. Any account can publish an
    // attestation-shaped message naming somebody else's order.
    expect(reply).not.toContain("certified reviewer");
    expect(reply).toContain("Signed by account 0.0.5");
    expect(reply).toContain("Credential claimed: cpa-us");
    expect(reply).toContain("Not checked against a registry in this build.");
  });

  it("still says the credential is unchecked when the attestation names none", () => {
    const reply = deliveredReply({ verdict: "approve", signedBy: "0.0.5" });
    expect(reply).toContain("not checked against a registry");
  });
});
