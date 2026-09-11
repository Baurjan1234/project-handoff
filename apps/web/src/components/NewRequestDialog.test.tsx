import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { expectNoBannedWords } from "../screens/fixtures";
import type { QuoteOutcome, RequestDraft } from "../requests/create";
import { MoneyUnitProvider } from "./Money";
import { NewRequestForm } from "./NewRequestDialog";

const DRAFT: RequestDraft = {
  spec: "Check the quarterly summary against the filing period.",
  artifact: "FAKE DOCUMENT — fabricated for the demo.",
  certTag: "cpa-us",
  priceHbar: "100",
  deadline: "2026-09-14T00:00:00Z",
  claimTimeoutSeconds: "1800",
};

const QUOTED: QuoteOutcome = {
  kind: "quoted",
  quote: {
    orderId: "ord_933180f5c38e4661a3a41f8906af918a",
    escrowAccountId: "0.0.10422187",
    validUntil: "2026-09-10T12:37:52Z",
    serviceFeeTinybars: "50000000",
    payTo: "0.0.10376656",
  },
};

function render({
  draft = DRAFT,
  problems = [],
  outcome = null,
  busy = false,
  tags = [{ code: "cpa-us", label: "Licensed reviewer" }],
}: {
  draft?: RequestDraft;
  problems?: readonly string[];
  outcome?: QuoteOutcome | null;
  busy?: boolean;
  tags?: ReadonlyArray<{ code: string; label: string }>;
} = {}) {
  return renderToStaticMarkup(
    <MoneyUnitProvider mirrorNodeUrl="https://testnet.mirrornode.hedera.com/api/v1">
      <NewRequestForm
        draft={draft}
        onDraft={() => {}}
        tags={tags}
        problems={problems}
        outcome={outcome}
        busy={busy}
        onQuote={() => {}}
        onClose={() => {}}
      />
    </MoneyUnitProvider>,
  );
}

describe("NewRequestForm, the ask", () => {
  it("asks for the work, the reviewer, the worth and the two clocks", () => {
    const html = render();
    expect(html).toContain("New request");
    expect(html).toContain("What should be reviewed?");
    expect(html).toContain("The work itself");
    expect(html).toContain("Who should review it?");
    expect(html).toContain("Worth (HBAR)");
    expect(html).toContain("Claim window (seconds)");
    expect(html).toContain("Deadline");
    expect(html).toContain("Get the price");
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("picks the deadline on a calendar and says back the instant it means", () => {
    const html = render();
    expect(html).toContain('type="datetime-local"');
    // The picker shows local time, so the UTC the order carries is on screen
    // beside it rather than left to be worked out.
    expect(html).toContain("2026-09-14T00:00:00Z");
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("says the work is delivered and only its fingerprint is published", () => {
    const html = render();
    expect(html).toContain("Only the fingerprint is");
    expect(html).toContain("Use fabricated content only.");
  });

  it("offers the reviewers the service listed, code and all", () => {
    const html = render();
    expect(html).toContain("Licensed reviewer");
    expect(html).toContain("cpa-us");
  });

  it("says so rather than guessing when the service listed nobody", () => {
    const html = render({ tags: [] });
    expect(html).toContain("has not listed any reviewers");
  });

  it("refuses to ask for a price while the draft is wrong, and lists what is wrong", () => {
    const html = render({ problems: ["Say what you want reviewed.", "The deadline has already passed."] });
    expect(html).toContain("Say what you want reviewed.");
    expect(html).toContain("The deadline has already passed.");
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>Get the price<\/button>/);
  });

  it("holds both buttons while the service is being asked", () => {
    const html = render({ busy: true });
    expect(html).toContain("Asking…");
    expect(html.match(/\sdisabled=""/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("passes a refusal through in the service's own words", () => {
    const html = render({ outcome: { kind: "refused", message: "No reviewer holds cpa-uk. Nothing was charged." } });
    expect(html).toContain("Nothing was charged.");
  });

  it("says nothing was sent when the browser could not reach the service", () => {
    const html = render({
      outcome: { kind: "unreachable", message: "The ordering service did not answer. Nothing was sent." },
    });
    expect(html).toContain("Nothing was sent.");
    expect(expectNoBannedWords(html)).toEqual([]);
  });
});

describe("NewRequestForm, the price", () => {
  it("shows the order, both amounts and the escrow, and says nothing is charged yet", () => {
    const html = render({ outcome: QUOTED });
    expect(html).toContain("Your request is priced");
    expect(html).toContain("ord_933180f5c38e4661a3a41f8906af918a");
    expect(html).toContain("0.0.10422187");
    // The two money flows, never conflated: the order value and the fee.
    expect(html).toContain("100 HBAR");
    expect(html).toContain("0.5 HBAR");
    expect(html).toContain("Held for the reviewer");
    expect(html).toContain("Service fee");
    expect(html).toContain("Nothing has been charged");
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("is straight about why the browser stops, without naming a key type", () => {
    const html = render({ outcome: QUOTED });
    expect(html).toContain("does not hold a key");
    expect(html).toContain("handoff_verify");
    expect(html).toContain("Copy the arguments");
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("does not offer to ask again from the priced state", () => {
    const html = render({ outcome: QUOTED });
    expect(html).not.toContain("Get the price");
    expect(html).toContain("Done");
  });

  it("leaves the fee row out when the quote did not carry one", () => {
    const html = render({ outcome: { kind: "quoted", quote: { ...QUOTED.quote, serviceFeeTinybars: null } } });
    expect(html).not.toContain("Service fee");
    expect(html).toContain("ord_933180f5c38e4661a3a41f8906af918a");
  });
});
