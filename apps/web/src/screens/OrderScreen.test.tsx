import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ClaimState } from "../orders/order";
import type { ClaimFlow } from "../orders/useClaimFlow";
import { claimFlow, expectNoBannedWords, idleClaim, NOW, order, SIGN_BY, utc } from "./fixtures";
import { OrderScreen } from "./OrderScreen";

function render(claim: ClaimState, flow: ClaimFlow = idleClaim, now = NOW, o = order()) {
  return renderToStaticMarkup(
    <OrderScreen order={o} claim={claim} flow={flow} now={now} onBack={() => {}} onOpenWorkspace={() => {}} />,
  );
}

const confirmation = (phase: "confirming" | "yours" | "someone-else" | "stalled", state: ClaimState | null = null) => ({
  phase,
  elapsedMs: 3_000,
  claimTransactionId: "MOCK-tx-5",
  state,
  lastReadError: null,
});

describe("OrderScreen", () => {
  it("shows the ask before Claim and keeps the document for after", () => {
    const html = render({ kind: "open" });
    expect(html).toContain("What the requester is asking");
    expect(html).toContain("review the attached summary");
    expect(html).toContain("The document opens after you claim.");
    expect(html).toMatch(/<button[^>]*>Claim<\/button>/);
    expect(html).toContain("Required credential:");
    expect(html).toContain("100 HBAR");
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("reads Confirming after the click, the same labeled state as payout", () => {
    const html = render({ kind: "open" }, claimFlow({ kind: "confirming", confirmation: confirmation("confirming") }));
    expect(html).toContain("Confirming");
    expect(html).toContain("Waiting for the network to confirm");
    expect(html).not.toMatch(/<button[^>]*>Claim<\/button>/);
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("opens the workspace only on a confirmed claim, with the clock as a time and the notes-kept line", () => {
    const yours: ClaimState = { kind: "yours", claimedAtEpochSeconds: 0, signBy: SIGN_BY };
    const html = render({ kind: "open" }, claimFlow({ kind: "decided", confirmation: confirmation("yours", yours) }));
    expect(html).toContain("Claimed · yours to review");
    expect(html).toContain("Sign by");
    expect(html).toContain("18:12");
    expect(html).toContain("Open the document");
    expect(html).toContain("Your notes are kept.");
    expect(html).not.toMatch(/min left/);
  });

  it("replaces the button when someone else claimed it, with no red and no retry", () => {
    const html = render({ kind: "open" }, claimFlow({ kind: "decided", confirmation: confirmation("someone-else", { kind: "someone-else" }) }));
    expect(html).toContain("Someone else claimed this.");
    expect(html).not.toMatch(/<button[^>]*>Claim<\/button>/);
    expect(html).not.toContain('data-variant="destructive"');
    expect(html).not.toContain("text-destructive");
    expect(html).not.toContain("Check again");
  });

  it("says the same when the inbox already knew", () => {
    expect(render({ kind: "someone-else" })).toContain("Someone else claimed this.");
  });

  it("refuses Claim too close to the deadline, and after it", () => {
    const soon = render({ kind: "open" }, idleClaim, new Date(2026, 8, 8, 19, 55, 0));
    expect(soon).toContain("Too close to the deadline to review.");
    expect(soon).not.toMatch(/<button[^>]*>Claim<\/button>/);
    const late = render({ kind: "open" }, idleClaim, new Date(2026, 8, 8, 20, 0, 1));
    expect(late).toContain("Deadline passed · funds returned to the requester");
  });

  it("offers a read again when the network goes quiet, and says nothing is re-sent", () => {
    const html = render({ kind: "open" }, claimFlow({ kind: "decided", confirmation: confirmation("stalled") }));
    expect(html).toContain("Check again");
    expect(html).toContain("nothing is re-sent");
  });

  it("keeps the failed submit an ordinary retry: nothing was sent", () => {
    const html = render({ kind: "open" }, claimFlow({ kind: "error", message: "network down" }));
    expect(html).toContain("Not claimed");
    expect(html).toContain("Nothing was sent");
    expect(html).toMatch(/<button[^>]*>Claim<\/button>/);
  });

  it("never shows a countdown, whichever day the deadline is", () => {
    const tomorrow = order({ envelope: { ...order().envelope, deadline: utc(new Date(2026, 8, 9, 9, 0, 0)) } });
    expect(render({ kind: "open" }, idleClaim, NOW, tomorrow)).toContain("tomorrow 09:00");
  });
});
