import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MoneyUnitProvider } from "../components/Money";
import type { MyRequest } from "../requests/source";
import type { RequestStatus } from "../requests/status";
import { expectNoBannedWords } from "./fixtures";
import { MyRequestsScreen, stampToUtc } from "./MyRequestsScreen";

const NOW = new Date("2026-09-10T12:00:00Z");
const ORDER = "ord_e2d590fed20043769bef835412897fd2";

const REQUEST: MyRequest = {
  orderId: ORDER,
  amountTinybars: 10_000_000_000n,
  lockTransactionId: "0.0.10376659@1789043079.412979170",
  lockedAt: "1789043088.487240617",
};

function status(overrides: Partial<RequestStatus> = {}): RequestStatus {
  return {
    orderId: ORDER,
    state: "POSTED",
    envelope: { certTag: "cpa-us", priceTinybars: "10000000000", deadline: "2026-09-14T00:00:00Z", orderClass: "review" },
    postedAt: "1789043088.487240617",
    verdict: null,
    defectCount: null,
    signedBy: null,
    signedAt: null,
    claimReadable: false,
    ...overrides,
  };
}

function render(props: Partial<Parameters<typeof MyRequestsScreen>[0]> = {}) {
  return renderToStaticMarkup(
    // The rate provider wraps it in the app, and an amount outside one cannot
    // switch units, so the test renders it the way the app does.
    <MoneyUnitProvider mirrorNodeUrl="https://testnet.mirrornode.hedera.com/api/v1">
      <MyRequestsScreen
        requests={[REQUEST]}
        statuses={new Map([[ORDER, status()]])}
        now={NOW}
        onNew={() => {}}
        onRefresh={() => {}}
        {...props}
      />
    </MoneyUnitProvider>,
  );
}

describe("MyRequestsScreen, the list", () => {
  it("names the order, what it is worth and who it is for", () => {
    const html = render();
    expect(html).toContain("My requests");
    expect(html).toContain(ORDER);
    expect(html).toContain("100 HBAR");
    expect(html).toContain("cpa-us");
    expect(html).toContain("New request");
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("says the amount is held for the reviewer, never that it was paid to anyone", () => {
    const html = render();
    expect(html).toContain("held for the reviewer");
    expect(html).not.toMatch(/was paid 100/);
  });

  it("links the requester's own payment as the proof it happened", () => {
    const html = render();
    expect(html).toContain("hashscan.io/testnet/transaction/0.0.10376659@1789043079.412979170");
    expect(html).toContain("Your payment");
  });

  it("says the work was found on the network, not reported by anyone", () => {
    expect(render()).toContain("found on the network rather than taken on trust");
  });
});

describe("MyRequestsScreen, what it refuses to claim", () => {
  it("says Open, and says out loud that it cannot see who is reviewing", () => {
    const html = render();
    expect(html).toContain("Open");
    expect(html).toContain("still reads as Open");
    // The one thing a requester would act on wrongly.
    expect(html).not.toMatch(/nobody has (claimed|taken)/i);
    expect(html).not.toMatch(/waiting for a reviewer/i);
  });

  it("drops that line once the service can see claims", () => {
    const html = render({ statuses: new Map([[ORDER, status({ claimReadable: true })]]) });
    expect(html).not.toContain("still reads as Open");
  });

  it("names the account that signed and never calls it certified", () => {
    const html = render({
      statuses: new Map([
        [ORDER, status({ state: "DELIVERED", verdict: "reject", signedBy: "0.0.10347668", defectCount: 2 })],
      ]),
    });
    expect(html).toContain("Reject");
    expect(html).toContain("0.0.10347668");
    expect(html).toContain("2 issues listed");
    expect(html).not.toMatch(/certified reviewer/i);
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("counts one issue as one", () => {
    const html = render({
      statuses: new Map([[ORDER, status({ verdict: "approve_with_changes", signedBy: "0.0.1", defectCount: 1 })]]),
    });
    expect(html).toContain("1 issue listed");
  });
});

describe("MyRequestsScreen, the states with no rows", () => {
  it("shows the shape of the list while the first read is in flight", () => {
    const html = render({ requests: null });
    expect(html).toContain("aria-busy");
    expect(html).not.toContain("animate-spin");
  });

  it("says nothing yet, in a sentence", () => {
    const html = render({ requests: [] });
    expect(html).toContain("Nothing yet.");
    expect(html).toContain("paid into escrow");
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("keeps what it found when the read fails, and says why", () => {
    const html = render({ failure: "The network answered 503 when reading your requests." });
    expect(html).toContain("Anything already found stays below.");
    // The row is still there.
    expect(html).toContain(ORDER);
  });

  it("refuses to pretend on the stand-in chain, and offers no create button", () => {
    const html = render({ live: false, onNew: undefined });
    expect(html).toContain("stand-in chain");
    expect(html).not.toContain("New request");
    expect(html).not.toContain("Check again");
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("reports a status it could not read as not read, never as open", () => {
    const html = render({ statuses: new Map([[ORDER, null]]) });
    expect(html).toContain("Not read");
    expect(html).not.toContain(">Open<");
  });
});

describe("the network's clock", () => {
  it("turns a consensus stamp into the instant the rest of the app speaks", () => {
    expect(stampToUtc("1789043088.487240617")).toBe("2026-09-10T12:24:48Z");
    expect(stampToUtc("")).toBe("");
    expect(stampToUtc("nonsense")).toBe("");
  });
});
