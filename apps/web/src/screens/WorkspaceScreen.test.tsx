import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Draft } from "../lib/draft";
import type { SignFlow } from "../sign/useSignFlow";
import { PUBLISHED_STAMP } from "../components/PublishedStatus";
import { drafts, expectNoBannedWords, IDENTITY, idleSign, NOW, order, record, settlement, SIGN_BY, signedFlow, utc } from "./fixtures";
import { WorkspaceScreen } from "./WorkspaceScreen";

const READY: Draft = {
  notes: "Footnote 2 dates the filing before the period ends.",
  issues: ["Footnote 2 is dated before the period ends"],
  verdict: "reject",
  step: "sign",
};

function render({
  draft = null,
  flow = idleSign,
  now = NOW,
  signBy = SIGN_BY,
  artifactText = "FAKE DOCUMENT — fabricated.",
  issueDraft = "",
  mode = "mock" as const,
}: {
  draft?: Draft | null;
  flow?: SignFlow;
  now?: Date;
  signBy?: string;
  artifactText?: string | null;
  issueDraft?: string;
  mode?: "mock" | "testnet";
} = {}) {
  return renderToStaticMarkup(
    <WorkspaceScreen
      mode={mode}
      identity={IDENTITY}
      order={order()}
      signBy={signBy}
      artifactText={artifactText}
      flow={flow}
      now={now}
      drafts={drafts(draft)}
      onBackToInbox={() => {}}
      initialIssueDraft={issueDraft}
    />,
  );
}

describe("WorkspaceScreen, the paper and the bar", () => {
  it("keeps the ask and the document beside the verdict, with the clock as a time", () => {
    const html = render();
    expect(html).toContain("Quarterly summary");
    expect(html).toContain("review the attached summary");
    expect(html).toContain("Sign by");
    expect(html).toContain("18:12");
    expect(html).toContain("In review");
    expect(html).toContain("FAKE");
    expect(html).toContain("FAKE DOCUMENT");
    expect(html).toContain("100 HBAR");
    expect(html).not.toMatch(/min left|22h left|Due in/);
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("shows a skeleton, not a spinner, while the document arrives", () => {
    const html = render({ artifactText: null });
    expect(html).toContain("aria-busy");
    expect(html).toContain("FAKE");
  });
});

describe("WorkspaceScreen, the whole verdict at once", () => {
  it("puts verdict, issues, notes and summary on one screen, behind no step", () => {
    const html = render();
    expect(html).toContain("Your verdict");
    expect(html).toContain("Issues");
    expect(html).toContain("Your notes");
    expect(html).toContain("Summary");
    expect(html).toContain("Sign verdict");
    // The step mark stays as progress: three labels, none of them a gate.
    for (const step of ["Notes", "Verdict", "Sign"]) expect(html).toContain(step);
  });

  it("preselects no verdict and refuses to sign until one is chosen", () => {
    const html = render();
    expect(html).not.toContain('data-state="checked"');
    expect(html).toContain("Pick a verdict.");
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>Sign verdict<\/button>/);
    expect(html).toContain("A reject is paid.");
    expect(html).not.toMatch(/recommend/i);
    for (const word of ["Approve", "Approve with changes", "Reject"]) expect(html).toContain(word);
  });

  it("clears every blocker once the verdict and the writing are there", () => {
    const html = render({ draft: READY });
    expect(html).toContain('data-state="checked"');
    // Nothing left to fix, so the hint takes the blockers' place. The button
    // itself waits on the fingerprint, which is computed after the first paint.
    expect(html).not.toContain("Pick a verdict.");
    expect(html).not.toContain("Write your notes.");
    expect(html).toContain("Your name is permanently linked to this verdict.");
  });
});

describe("WorkspaceScreen, issues", () => {
  it("numbers each issue and keeps its sentence beside the code", () => {
    const html = render({ draft: { ...READY, issues: ["Missing receipt", "Over policy limit"] } });
    expect(html).toContain("D-001");
    expect(html).toContain("Missing receipt");
    expect(html).toContain("D-002");
    expect(html).toContain("Over policy limit");
    expect(html).toContain("2 of 8 issues");
    expect(html).toContain("Add issue");
  });

  it("says which half is public and which half is delivered", () => {
    const html = render({ draft: { ...READY, issues: ["Missing receipt"] } });
    expect(html).toContain("Public forever, under your account: the verdict and the issue codes");
    expect(html).toContain("Private, delivered to the requester");
  });

  it("refuses while an issue sits uncommitted in the box", () => {
    const html = render({ draft: READY, issueDraft: "Totals do not foot" });
    expect(html).toContain("Add or clear the issue you typed.");
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>Sign verdict<\/button>/);
  });

  it("asks for the writing when there is neither a note nor an issue", () => {
    const html = render({ draft: { ...READY, notes: "", issues: [] } });
    expect(html).toContain("Write your notes.");
  });
});

describe("WorkspaceScreen, the summary", () => {
  it("names the signer, the verdict, the codes and the fingerprint", () => {
    const html = render({ draft: READY });
    expect(html).toContain("Signed by");
    expect(html).toContain("0.0.12345");
    expect(html).toContain("demo-reviewer");
    expect(html).toContain("Reject");
    expect(html).toContain("D-001");
    expect(html).toContain("Notes fingerprint");
    expect(html).toContain("Show verification details");
    expect(html).toContain("exact document the requester committed to");
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("says None when there are no issues", () => {
    const html = render({ draft: { ...READY, issues: [] } });
    expect(html).toContain("None");
  });
});

describe("WorkspaceScreen, after the sign", () => {
  it("stamps Published with its proof, then Confirming, and reserves the proof row's space", () => {
    const html = render({ draft: READY, flow: signedFlow(settlement({ elapsedMs: 2_000 })) });
    expect(html).toContain(PUBLISHED_STAMP);
    expect(html).toContain("MOCK-tx-3");
    expect(html).toContain("Confirming");
    expect(html).toContain("Waiting for the network to confirm");
    expect(html).not.toContain("Sign verdict");
    expect(html).toContain("min-h-5");
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("says Paid with the amount and the payee, and its proof", () => {
    const state = settlement({
      phase: "settled",
      elapsedMs: 12_000,
      attestation: record("MOCK-tx-3"),
      payoutTransactionId: "MOCK-tx-7",
      payout: record("MOCK-tx-7"),
    });
    const html = render({ draft: READY, flow: signedFlow(state) });
    expect(html).toContain("Paid ·");
    expect(html).toContain("100 HBAR");
    expect(html).toContain("to your account");
    expect(html).toContain("MOCK-tx-7");
    expect(html).toContain("Back to the inbox");
    expect(html).not.toContain("hashscan.io/testnet/transaction/");
  });

  it("links real ids on testnet", () => {
    const tx = "0.0.12345@1757000000.000000000";
    const payout = "0.0.4242@1757000010.000000000";
    const state = settlement({
      phase: "settled",
      attestationTransactionId: tx,
      attestation: record(tx),
      payoutTransactionId: payout,
      payout: record(payout),
    });
    const html = render({ draft: READY, flow: signedFlow(state), mode: "testnet" });
    expect(html).toContain(`hashscan.io/testnet/transaction/${tx}`);
    expect(html).toContain(`hashscan.io/testnet/transaction/${payout}`);
  });

  it("becomes payment pending after the network goes quiet, never an endless pulse", () => {
    const html = render({ draft: READY, flow: signedFlow(settlement({ phase: "stalled", elapsedMs: 60_000, slow: true })) });
    expect(html).toContain("Published · payment pending");
    expect(html).toContain("Payment lands when the service recovers");
    expect(html).toContain("Check again");
    expect(html).not.toContain("animate-pulse");
  });

  it("carries a recourse line on the format-check failure, with what the network said one click down", () => {
    const state = settlement({
      phase: "failed",
      attestation: { ...record("MOCK-tx-3"), status: "FAILED" },
      failure: "the network reports the verdict transaction as FAILED",
    });
    const html = render({ draft: READY, flow: signedFlow(state) });
    expect(html).toContain("Could not pay out");
    expect(html).toContain("failed the format check");
    expect(html).toContain("Contact us");
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("reports a platform issue without taking back the verdict", () => {
    const html = render({ draft: READY, flow: signedFlow(settlement({ elapsedMs: 2_000 }), { platformIssue: "verifier unreachable" }) });
    expect(html).toContain("The stand-in platform failed: verifier unreachable");
    expect(html).toContain("Your verdict stands regardless");
  });
});

describe("WorkspaceScreen, the exits", () => {
  it("says the claim expired and the notes are kept, once the sign-by time has passed", () => {
    const html = render({ draft: READY, now: new Date(2026, 8, 8, 18, 13, 0) });
    expect(html).toContain("Claim expired · this order is back in the inbox.");
    expect(html).toContain("Your notes are kept");
    expect(html).not.toContain("Sign verdict");
  });

  it("does not expire a claim that was already signed", () => {
    const html = render({ draft: READY, now: new Date(2026, 8, 8, 18, 13, 0), flow: signedFlow(settlement()) });
    expect(html).toContain(PUBLISHED_STAMP);
    expect(html).not.toContain("Claim expired");
  });

  it("keeps the sign-by time honest when it is the deadline itself", () => {
    const html = render({ signBy: utc(new Date(2026, 8, 8, 20, 0, 0)) });
    expect(html).toContain("20:00");
  });
});
