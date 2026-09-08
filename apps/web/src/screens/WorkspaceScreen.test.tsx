import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Draft } from "../lib/draft";
import type { SignFlow } from "../sign/useSignFlow";
import { drafts, expectNoBannedWords, IDENTITY, idleSign, NOW, order, record, settlement, SIGN_BY, signedFlow, utc } from "./fixtures";
import { PUBLISHED_STAMP } from "../components/PublishedStatus";
import { WorkspaceScreen } from "./WorkspaceScreen";

const READY: Draft = { notes: "Footnote 2 dates the filing before the period ends.", defects: ["FN-2-DATE"], verdict: "reject", step: "sign" };

function render({
  draft = null,
  flow = idleSign,
  now = NOW,
  signBy = SIGN_BY,
  artifactText = "FAKE DOCUMENT — fabricated.",
  defectDraft = "",
  mode = "mock" as const,
}: {
  draft?: Draft | null;
  flow?: SignFlow;
  now?: Date;
  signBy?: string;
  artifactText?: string | null;
  defectDraft?: string;
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
      initialDefectDraft={defectDraft}
    />,
  );
}

describe("WorkspaceScreen, the column beside the document", () => {
  it("carries the brief and the clock in, with the three-step mark, and the document on the left", () => {
    const html = render();
    expect(html).toContain("What the requester is asking");
    expect(html).toContain("review the attached summary");
    expect(html).toContain("Sign by");
    expect(html).toContain("18:12");
    expect(html).toContain("FAKE");
    expect(html).toContain("FAKE DOCUMENT");
    for (const step of ["Notes", "Verdict", "Sign"]) expect(html).toContain(step);
    expect(html).not.toMatch(/min left|remaining/);
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("starts on notes, with the budget in characters and the uppercase convention in the placeholder", () => {
    const html = render();
    expect(html).toContain("Your notes");
    expect(html).toContain("characters left");
    expect(html).toContain("NO_MONITORING");
    expect(html).toContain("Private. Delivered to the requester");
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>Continue to verdict<\/button>/);
  });

  it("shows a skeleton, not a spinner, while the document arrives", () => {
    const html = render({ artifactText: null });
    expect(html).toContain("aria-busy");
    expect(html).toContain("FAKE");
  });
});

describe("WorkspaceScreen, the verdict", () => {
  it("preselects nothing and disables Continue until one is chosen", () => {
    const html = render({ draft: { ...READY, verdict: null, step: "verdict" } });
    expect(html).not.toContain('data-state="checked"');
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>Continue<\/button>/);
    expect(html).toContain("A reject is paid.");
    expect(html).not.toMatch(/recommend/i);
    for (const word of ["Approve", "Approve with changes", "Reject"]) expect(html).toContain(word);
  });

  it("enables Continue once a verdict is chosen", () => {
    const html = render({ draft: { ...READY, step: "verdict" } });
    expect(html).toContain('data-state="checked"');
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>Continue<\/button>/);
  });
});

describe("WorkspaceScreen, the sign summary", () => {
  it("is structured: signing-as, public forever with the real codes, private with the notes, fingerprints one click down", () => {
    const html = render({ draft: READY });
    expect(html).toContain("Signing as");
    expect(html).toContain("0.0.12345");
    expect(html).toContain("demo-reviewer");
    expect(html).toContain("Public forever, under your account");
    expect(html).toContain("Reject");
    expect(html).toContain("FN-2-DATE");
    expect(html).toContain("Private · delivered to the requester");
    expect(html).toContain("Footnote 2 dates the filing");
    expect(html).toContain("<summary");
    expect(html).toContain("Fingerprints");
    expect(html).toContain("exact document the requester committed to");
    expect(html).toContain("Sign &amp; publish");
    expect(html).toContain("Change verdict");
    expect(html).toContain("Back to the document");
    expect(html).not.toContain("Not yet");
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("refuses while a defect code sits uncommitted, and while the notes are empty", () => {
    const typed = render({ draft: READY, defectDraft: "FN-3-TOTAL" });
    expect(typed).toContain("Add or clear the defect code you typed.");
    expect(typed).toMatch(/<button[^>]*\sdisabled=""[^>]*>Sign &amp; publish<\/button>/);
    const empty = render({ draft: { ...READY, notes: "" } });
    expect(empty).toContain("Write your notes.");
  });
});

describe("WorkspaceScreen, after the sign", () => {
  it("stamps Published with its proof, then Confirming, and reserves the proof row's space", () => {
    const html = render({ draft: READY, flow: signedFlow(settlement({ elapsedMs: 2_000 })) });
    expect(html).toContain(PUBLISHED_STAMP);
    expect(html).toContain("MOCK-tx-3");
    expect(html).toContain("Confirming");
    expect(html).toContain("Waiting for the network to confirm");
    expect(html).not.toContain("Sign &amp; publish");
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
    expect(html).toContain("Paid · 100 HBAR");
    expect(html).toContain("to your account");
    expect(html).toContain("0.0.12345");
    expect(html).toContain("MOCK-tx-7");
    expect(html).toContain("Back to the inbox");
    expect(html).not.toContain("hashscan.io/testnet/transaction/");
    expect(expectNoBannedWords(html)).toEqual([]);
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
    expect(expectNoBannedWords(html)).toEqual([]);
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
    expect(html).toContain("the network reports the verdict transaction as FAILED");
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
    expect(html).not.toContain("Sign &amp; publish");
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
