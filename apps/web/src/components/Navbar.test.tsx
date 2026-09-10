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
  it("carries the wordmark, one tab with the open count, and the account", () => {
    const html = renderToStaticMarkup(<Navbar mode="testnet" identity={identity} openCount={3} onInbox={() => {}} onDisconnect={() => {}} />);
    expect(html).toContain("Handoff");
    expect(html).toContain("Inbox");
    expect(html).toContain(">3<");
    expect(html).toContain("0.0.12345");
    expect(expectNoBannedWords(html)).toEqual([]);
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

