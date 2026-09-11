/**
 * The 402 body below is the live one, captured from `POST /orders` on
 * 2026-09-10 with the transaction shortened. A 402 is the success case here:
 * it is the service quoting a price, which is what the call asked for.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEADLINE_DAYS,
  deadlineForPicker,
  deadlineFromPicker,
  decodeQuote,
  draftProblems,
  emptyDraft,
  encodeArtifact,
  handoffVerifyArguments,
  orderRequestBody,
  requestQuote,
  type RequestDraft,
} from "./create";

const NOW = new Date("2026-09-10T12:00:00Z");
const ME = "0.0.10376659";

const GOOD: RequestDraft = {
  spec: "Check the quarterly summary against the filing period.",
  artifact: "FAKE DOCUMENT — fabricated for the demo.",
  certTag: "cpa-us",
  priceHbar: "100",
  deadline: "2026-09-14T00:00:00Z",
  claimTimeoutSeconds: "1800",
};

const LIVE_402 = {
  x402Version: 2,
  accepts: [
    {
      scheme: "exact",
      network: "hedera:testnet",
      amount: "50000000",
      payTo: "0.0.10376656",
      maxTimeoutSeconds: 300,
      asset: "0.0.0",
      extra: { feePayer: "0.0.7162784" },
    },
  ],
  resource: { url: "https://api.the-handoff.xyz/orders" },
  fund_lock: {
    order_id: "ord_933180f5c38e4661a3a41f8906af918a",
    escrow_account_id: "0.0.10422187",
    transaction_bytes: "CokBKoYBCoEBChsKDAjsx4rVBhDt5amvARIJCAAQABjTq",
    memo: "ord_933180f5c38e4661a3a41f8906af918a",
    valid_until: "2026-09-10T12:37:52Z",
  },
};

describe("what the form refuses", () => {
  it("is happy with a complete draft", () => {
    expect(draftProblems(GOOD, NOW)).toEqual([]);
  });

  it("asks for the writing, the work and the reviewer", () => {
    const problems = draftProblems({ ...GOOD, spec: "  ", artifact: "", certTag: "" }, NOW);
    expect(problems).toContain("Say what you want reviewed.");
    expect(problems).toContain("Add the work to be reviewed.");
    expect(problems).toContain("Choose who should review it.");
  });

  it("refuses a price that is not an amount, and zero, which is not a price", () => {
    for (const priceHbar of ["", "lots", "-5", "0", "0.000000001"]) {
      expect(draftProblems({ ...GOOD, priceHbar }, NOW)).toContain("The price must be an amount of HBAR, like 100.");
    }
  });

  it("refuses a deadline that is not a UTC instant", () => {
    for (const deadline of ["", "tomorrow", "2026-09-14", "2026-09-14T00:00:00+08:00"]) {
      expect(draftProblems({ ...GOOD, deadline }, NOW)).toContain(
        "The deadline must be a UTC time like 2026-09-14T00:00:00Z.",
      );
    }
  });

  it("refuses a deadline that has gone", () => {
    expect(draftProblems({ ...GOOD, deadline: "2026-09-09T00:00:00Z" }, NOW)).toContain("The deadline has already passed.");
  });

  it("holds the treaty's claim-window bounds rather than restating them", () => {
    expect(draftProblems({ ...GOOD, claimTimeoutSeconds: "60" }, NOW)).toContain(
      "The claim window must be between 300 and 21600 seconds.",
    );
    expect(draftProblems({ ...GOOD, claimTimeoutSeconds: "99999" }, NOW)).toContain(
      "The claim window must be between 300 and 21600 seconds.",
    );
    expect(draftProblems({ ...GOOD, claimTimeoutSeconds: "1.5" }, NOW)).toContain(
      "The claim window must be a whole number of seconds.",
    );
  });

  it("refuses a claim window too close to the deadline, which is how funds get held", () => {
    // Four hours to the deadline allows a third of it, so five hours is out
    // even though it is inside the absolute bound.
    const problems = draftProblems(
      { ...GOOD, deadline: "2026-09-10T16:00:00Z", claimTimeoutSeconds: "18000" },
      NOW,
    );
    expect(problems.some((p) => p.startsWith("The claim window is too close to the deadline."))).toBe(true);
  });
});

describe("what the form opens on", () => {
  const THREE_DAYS_MS = DEFAULT_DEADLINE_DAYS * 24 * 3_600_000;

  // Asserted against the clock rather than against a literal: the picker and
  // this default both go through the machine's own time zone, and a literal
  // would only pass on one of them.
  it("opens on a deadline three days out, on the hour", () => {
    const { deadline } = emptyDraft(NOW);
    expect(deadline).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/);
    const ahead = Date.parse(deadline) - NOW.getTime();
    expect(ahead).toBeGreaterThanOrEqual(THREE_DAYS_MS);
    expect(ahead).toBeLessThanOrEqual(THREE_DAYS_MS + 3_600_000);
  });

  it("opens on a ten-minute claim window", () => {
    expect(emptyDraft(NOW).claimTimeoutSeconds).toBe("600");
  });

  // The point of the defaults: what is left to do is the work, not the clocks.
  it("leaves only the work, the document and the reviewer to fill in", () => {
    expect(draftProblems(emptyDraft(NOW), NOW)).toEqual([
      "Say what you want reviewed.",
      "Add the work to be reviewed.",
      "Choose who should review it.",
    ]);
  });
});

describe("the date picker, which speaks local time", () => {
  it("round-trips a deadline through the picker unchanged", () => {
    const { deadline } = emptyDraft(NOW);
    expect(deadlineFromPicker(deadlineForPicker(deadline))).toBe(deadline);
  });

  it("reads a picked local time as the instant that person meant", () => {
    const picked = deadlineFromPicker("2026-09-14T09:30");
    expect(picked).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/);
    expect(Date.parse(picked)).toBe(new Date("2026-09-14T09:30").getTime());
  });

  it("has nothing to show, and makes no deadline, out of what is not one", () => {
    for (const notADeadline of ["", "  ", "tomorrow", "2026-09-14T00:00:00+08:00"]) {
      expect(deadlineForPicker(notADeadline)).toBe("");
    }
    for (const notAPick of ["", "  ", "nonsense"]) {
      expect(deadlineFromPicker(notAPick)).toBe("");
    }
  });
});

describe("the body it posts", () => {
  it("names the requester, encodes the work and sends the seconds as a number", () => {
    const body = orderRequestBody(GOOD, ME);
    expect(body["class"]).toBe("review");
    expect(body["requester_account_id"]).toBe(ME);
    expect(body["cert_tag"]).toBe("cpa-us");
    expect(body["price_hbar"]).toBe("100");
    expect(body["claim_timeout_seconds"]).toBe(1800);
    expect(body["artifact_base64"]).toBe(encodeArtifact(GOOD.artifact));
    // The document itself is never in the body in the clear.
    expect(JSON.stringify(body)).not.toContain("FAKE DOCUMENT");
  });

  it("round-trips the work through base64, em dash and all", () => {
    expect(atob(encodeArtifact("FAKE — naïve"))).toBe(
      String.fromCharCode(...new TextEncoder().encode("FAKE — naïve")),
    );
  });
});

describe("reading the quote", () => {
  it("reads the live 402", () => {
    const quote = decodeQuote(LIVE_402);
    expect(quote?.orderId).toBe("ord_933180f5c38e4661a3a41f8906af918a");
    expect(quote?.escrowAccountId).toBe("0.0.10422187");
    expect(quote?.serviceFeeTinybars).toBe("50000000");
    expect(quote?.payTo).toBe("0.0.10376656");
    expect(quote?.validUntil).toBe("2026-09-10T12:37:52Z");
  });

  it("refuses a quote with no lock, because there would be nothing to pay into", () => {
    const { fund_lock: _dropped, ...noLock } = LIVE_402;
    expect(decodeQuote(noLock)).toBeNull();
    expect(decodeQuote({ ...LIVE_402, fund_lock: { escrow_account_id: "0.0.1" } })).toBeNull();
    expect(decodeQuote(null)).toBeNull();
  });

  it("still reads the lock when the fee is quoted in a shape it does not know", () => {
    const quote = decodeQuote({ ...LIVE_402, accepts: [] });
    expect(quote?.orderId).toBe("ord_933180f5c38e4661a3a41f8906af918a");
    expect(quote?.serviceFeeTinybars).toBeNull();
  });
});

describe("asking for a price", () => {
  const answering = (status: number, body: unknown): typeof fetch =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("treats the 402 as the answer it wanted", async () => {
    const outcome = await requestQuote({
      apiUrl: "https://api.example",
      draft: GOOD,
      requesterAccountId: ME,
      fetchImpl: answering(402, LIVE_402),
    });
    expect(outcome.kind).toBe("quoted");
  });

  it("posts to /orders with the body as JSON", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const spy: typeof fetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify(LIVE_402), { status: 402 });
    }) as unknown as typeof fetch;

    await requestQuote({ apiUrl: "https://api.example/", draft: GOOD, requesterAccountId: ME, fetchImpl: spy });
    expect(seen[0]?.url).toBe("https://api.example/orders");
    expect(seen[0]?.init.method).toBe("POST");
    expect(String(seen[0]?.init.body)).toContain('"requester_account_id":"0.0.10376659"');
  });

  it("passes the service's own refusal through, which ends 'Nothing was charged.'", async () => {
    const outcome = await requestQuote({
      apiUrl: "https://api.example",
      draft: GOOD,
      requesterAccountId: ME,
      fetchImpl: answering(400, {
        error: "unknown credential tag",
        message: "No reviewer holds cpa-uk. Nothing was charged.",
      }),
    });
    expect(outcome).toEqual({ kind: "refused", message: "No reviewer holds cpa-uk. Nothing was charged." });
  });

  it("says nothing was sent when the browser never got an answer", async () => {
    const blocked: typeof fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const outcome = await requestQuote({
      apiUrl: "https://api.example",
      draft: GOOD,
      requesterAccountId: ME,
      fetchImpl: blocked,
    });
    expect(outcome.kind).toBe("unreachable");
    expect(outcome.kind === "unreachable" && outcome.message).toContain("Nothing was sent.");
  });

  it("says so when a price arrives with nowhere to send the money", async () => {
    const outcome = await requestQuote({
      apiUrl: "https://api.example",
      draft: GOOD,
      requesterAccountId: ME,
      fetchImpl: answering(402, { accepts: LIVE_402.accepts }),
    });
    expect(outcome.kind).toBe("unusable");
  });
});

describe("the handover", () => {
  it("hands the tool the document itself, not the encoded form", () => {
    const args = JSON.parse(handoffVerifyArguments(GOOD)) as Record<string, unknown>;
    expect(args["artifact"]).toBe(GOOD.artifact);
    expect(args["spec"]).toBe(GOOD.spec);
    expect(args["cert_tag"]).toBe("cpa-us");
    expect(args["price_hbar"]).toBe("100");
    expect(args["claim_timeout_seconds"]).toBe(1800);
    // No key, and nothing that could hold one.
    expect(Object.keys(args)).not.toContain("requester_account_id");
  });
});
