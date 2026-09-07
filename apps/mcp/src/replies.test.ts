import { describe, expect, it } from "vitest";
import { parseCertTags, ConfigError } from "./config.js";
import {
  clockTime,
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
    expect(lines[0]).toBe("Service fee settled · 0.5 HBAR");
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
});

describe("the wait", () => {
  it("answers with a time, once", () => {
    expect(waitingReply(DEADLINE)).toBe(
      "Posted · waiting for a certified reviewer. Open until 18:00 UTC.",
    );
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
