import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { InboxEntry } from "../orders/order";
import { expectNoBannedWords, NOW, order, SIGN_BY, utc } from "./fixtures";
import { firstLine, InboxScreen } from "./InboxScreen";

const open: InboxEntry = { order: order(), claim: { kind: "open" } };
const yours: InboxEntry = {
  order: order({ title: "Mine already" }),
  claim: { kind: "yours", claimedAtEpochSeconds: 0, signBy: SIGN_BY },
};
const theirs: InboxEntry = { order: order({ title: "Not for you" }), claim: { kind: "someone-else" } };
const expired: InboxEntry = {
  order: order({ title: "Too late", envelope: { ...order().envelope, deadline: utc(new Date(2026, 8, 8, 17, 0, 0)) } }),
  claim: { kind: "open" },
};

describe("InboxScreen", () => {
  it("gives the three facts before Claim: what, how big, how long, as two clocks side by side", () => {
    const html = renderToStaticMarkup(<InboxScreen entries={[open]} now={NOW} onOpen={() => {}} />);
    expect(html).toContain("Quarterly summary");
    expect(html).toContain("100 HBAR");
    expect(html).toContain("locked in escrow");
    expect(html).toContain("Open until");
    expect(html).toContain("20:00");
    expect(html).toContain("30 min to sign after you claim");
    expect(html).toContain("80 words");
    expect(html).toContain("demo-reviewer");
    expect(html).not.toMatch(/\d+ min left|remaining/);
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("hides orders claimed by others with a muted count, and drops past deadlines", () => {
    const html = renderToStaticMarkup(<InboxScreen entries={[open, yours, theirs, theirs, expired]} now={NOW} onOpen={() => {}} />);
    expect(html).not.toContain("Not for you");
    expect(html).not.toContain("Too late");
    expect(html).toContain("2 claimed by others");
    expect(html).toContain("Claimed · yours to review");
    expect(html).toContain("sign by 18:12");
  });

  it("says a sentence when empty, and a skeleton while loading", () => {
    expect(renderToStaticMarkup(<InboxScreen entries={[]} now={NOW} onOpen={() => {}} />)).toContain("No work right now.");
    const loading = renderToStaticMarkup(<InboxScreen entries={null} now={NOW} onOpen={() => {}} />);
    expect(loading).toContain("animate-pulse");
    expect(loading).not.toContain("No work");
  });

  it("takes the task line for the row, without the FAKE label", () => {
    expect(firstLine(order().ask)).toBe("review the attached summary for consistency.");
  });
});
