/**
 * The second ask. Radix renders the dialog through a portal, which a server
 * render cannot see, so the words are checked on the body where they live.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SignConfirm } from "./SignDialog";
import { expectNoBannedWords } from "../screens/fixtures";

function render(over: Partial<Parameters<typeof SignConfirm>[0]> = {}) {
  return renderToStaticMarkup(
    <SignConfirm
      verdict="reject"
      issueCount={3}
      accountId="0.0.12345"
      credentials={["demo-reviewer"]}
      busy={false}
      onSign={() => {}}
      onBack={() => {}}
      {...over}
    />,
  );
}

describe("SignConfirm", () => {
  it("asks once more and says why, echoing what will be published", () => {
    const html = render();
    expect(html).toContain("Sign this verdict?");
    expect(html).toContain("permanently recorded under your name");
    expect(html).toContain("cannot be changed or removed");
    expect(html).toContain("Reject");
    expect(html).toContain("3 issues");
    expect(html).toContain("0.0.12345");
    expect(html).toContain("demo-reviewer");
    expect(html).toContain("Go back");
    expect(html).toContain("Sign &amp; submit");
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("says None rather than a zero when nothing was flagged", () => {
    expect(render({ issueCount: 0 })).toContain("None");
  });

  it("carries the soft check for Approve with issues listed, as a question and not a block", () => {
    const html = render({ verdict: "approve", issueCount: 2 });
    expect(html).toContain("chose Approve");
    expect(html).toContain("That is allowed");
    // Still signable: the soft check never disables the button.
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>Sign &amp; submit<\/button>/);
  });

  it("does not ask the question when the verdict and the issues agree", () => {
    expect(render({ verdict: "reject", issueCount: 2 })).not.toContain("That is allowed");
    expect(render({ verdict: "approve", issueCount: 0 })).not.toContain("That is allowed");
  });

  it("holds both buttons while it publishes, so nothing is sent twice", () => {
    const html = render({ busy: true });
    expect(html).toContain("Publishing…");
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>Go back<\/button>/);
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>Publishing…<\/button>/);
  });
});
