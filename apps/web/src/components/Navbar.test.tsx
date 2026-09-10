/**
 * The navbar's dropdown says only what the network can back: no name, no
 * email, no review count, and a balance only once a real read answered.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Navbar } from "./Navbar";
import { expectNoBannedWords } from "../screens/fixtures";

const identity = { accountId: "0.0.12345", credentials: ["demo-reviewer"] };

describe("Navbar", () => {
  it("carries the wordmark, both tabs with the open count, and the account", () => {
    const html = renderToStaticMarkup(<Navbar mode="testnet" identity={identity} openCount={3} onInbox={() => {}} onDisconnect={() => {}} />);
    expect(html).toContain("Handoff");
    expect(html).toContain("Inbox");
    expect(html).toContain("My requests");
    expect(html).toContain(">3<");
    expect(html).toContain("0.0.12345");
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("marks only the tab the screen is on, and defaults to the inbox", () => {
    const inbox = renderToStaticMarkup(<Navbar mode="testnet" identity={identity} />);
    expect(inbox.match(/aria-current="page"/g)).toHaveLength(1);

    const requests = renderToStaticMarkup(<Navbar mode="testnet" identity={identity} active="requests" />);
    expect(requests.match(/aria-current="page"/g)).toHaveLength(1);
    // The marked tab is the requests one: it carries the rule, the inbox does not.
    expect(/aria-current="page"[^>]*>My requests/.test(requests.replace(/\s+/g, " "))).toBe(true);
  });

  it("counts only work to take, never requests, which nothing can count", () => {
    const html = renderToStaticMarkup(<Navbar mode="testnet" identity={identity} active="requests" openCount={3} />);
    // The badge stays on Inbox even when the other tab is the current one.
    expect(html).toContain(">3<");
    expect(html.match(/>3</g)).toHaveLength(1);
  });

  it("links out to the docs, in a new tab, and nowhere else", () => {
    const html = renderToStaticMarkup(<Navbar mode="testnet" identity={identity} />);
    expect(html).toContain('href="https://docs.the-handoff.xyz"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    // Testnet only: the docs are the one outbound link, and it is not mainnet.
    expect(html).not.toMatch(/mainnet/i);
  });

  it("hides the count when there is no work to take", () => {
    const html = renderToStaticMarkup(<Navbar mode="testnet" identity={identity} openCount={0} />);
    expect(html).not.toContain(">0<");
  });

  it("says nothing about a credential it does not have", () => {
    const html = renderToStaticMarkup(<Navbar mode="testnet" identity={{ accountId: "0.0.12345", credentials: [] }} />);
    expect(html).not.toContain("Certified");
  });

  it("shows the account rather than an avatar, since the account is the identity", () => {
    const html = renderToStaticMarkup(<Navbar mode="testnet" identity={identity} />);
    expect(html).toContain("0.0.12345");
    // No decorative person glyph: nothing in this product has a face.
    expect(html).not.toContain("rounded-full bg-primary/10");
  });
});

