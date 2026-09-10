/**
 * The claim dialog reports what the flow found. These render each of its
 * five states to markup, so the words a judge would read are checked here
 * rather than in a click-through, and the banned ones cannot creep in.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClaimReport } from "./ClaimDialog";
import type { ClaimConfirmation } from "../orders/claim";
import type { ClaimFlow } from "../orders/useClaimFlow";
import { expectNoBannedWords, NOW, order, SIGN_BY } from "../screens/fixtures";

const confirmation = (phase: ClaimConfirmation["phase"], state: ClaimConfirmation["state"] = null): ClaimConfirmation => ({
  phase,
  elapsedMs: 2_000,
  claimTransactionId: "MOCK-tx-5",
  state,
  lastReadError: null,
});

function flowWith(status: ClaimFlow["status"]): ClaimFlow {
  return { status, claim: async () => {}, checkAgain: () => {} };
}

/**
 * The body, not the dialog: Radix renders the dialog through a portal, which
 * a server render cannot see, so the words are checked where they live.
 */
function render(status: ClaimFlow["status"]) {
  return renderToStaticMarkup(
    <ClaimReport order={order()} flow={flowWith(status)} now={NOW} onOpenWorkspace={() => {}} onClose={() => {}} />,
  );
}

describe("ClaimDialog", () => {
  it("says what it is doing while the network is asked, with the order and the money", () => {
    const html = render({ kind: "confirming", confirmation: confirmation("confirming") });
    expect(html).toContain("Claiming review");
    expect(html).toContain("Submitting your claim. This takes a few seconds.");
    expect(html).toContain("Quarterly summary");
    expect(html).toContain("100 HBAR");
    // A long id must not widen the card: the row is a bounded grid.
    expect(html).toContain("grid-cols-[auto_minmax(0,1fr)]");
    expect(html).toContain("truncate");
    expect(html).toContain("animate-spin");
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("offers the workspace once the order is yours, with the clock as a time", () => {
    const html = render({ kind: "decided", confirmation: confirmation("yours", { kind: "yours", claimedAtEpochSeconds: 0, signBy: SIGN_BY }) });
    expect(html).toContain("Review claimed");
    expect(html).toContain("Start reviewing");
    expect(html).toContain("Sign by");
    expect(html).toContain("18:12");
    expect(html).not.toMatch(/min left|Due in/);
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("makes losing ordinary: no red, no queue, and the reopen said plainly", () => {
    const html = render({ kind: "decided", confirmation: confirmation("someone-else", { kind: "someone-else", holderSignBy: SIGN_BY, youClaimed: true }) });
    expect(html).toContain("Another expert was faster");
    expect(html).toContain("returns to the inbox");
    expect(html).toContain("claim it again");
    expect(html).not.toMatch(/queue|#2/i);
    expect(html).not.toContain("text-destructive");
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("offers a read again when the network goes quiet, and says nothing is re-sent", () => {
    const html = render({ kind: "decided", confirmation: confirmation("stalled") });
    expect(html).toContain("Still confirming");
    expect(html).toContain("nothing is re-sent");
    expect(html).toContain("Check again");
  });

  it("keeps a failed submit an ordinary retry: nothing was sent", () => {
    const html = render({ kind: "error", message: "network down" });
    expect(html).toContain("Not claimed");
    expect(html).toContain("Nothing was sent");
  });

  it("does not repeat the word Order when the title is the fallback form", () => {
    const long = order({ title: "Order ord_a642cdd14e234767aad968ca2dfafb24" });
    const html = renderToStaticMarkup(
      <ClaimReport order={long} flow={flowWith({ kind: "confirming", confirmation: confirmation("confirming") })} now={NOW} onOpenWorkspace={() => {}} onClose={() => {}} />,
    );
    expect(html).toContain("ord_a642cdd14e234767aad968ca2dfafb24");
    expect(html).not.toContain("Order ord_a642");
  });
});

