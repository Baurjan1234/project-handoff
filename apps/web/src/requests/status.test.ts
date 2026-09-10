/**
 * The body below is the real answer from the live service, copied verbatim
 * from `GET /orders/{id}` on 2026-09-10, so the decoder is tested against
 * what the server sends rather than what it was assumed to send.
 */

import { describe, expect, it } from "vitest";
import { decodeStatus, fetchRequestStatus } from "./status";

const LIVE = {
  orderId: "ord_5979205ba2844c258a0defe3cb3a08cf",
  state: "POSTED",
  claimReadable: false,
  envelope: {
    order_id: "ord_5979205ba2844c258a0defe3cb3a08cf",
    spec_hash: "cfd9e97e125363dd095a7fbc3f162a6d71697a0d9948afb4c95672d6005fe3d0",
    cert_tag: "cpa-us",
    price_tinybars: "100000000",
    deadline: "2026-09-14T00:00:00Z",
    claim_timeout_seconds: 1800,
    schema_version: 1,
    class: "review",
    artifact_hash_in: "f794ab367c064283c39e967ca3801a07f8a24353f749df9c103b8e1bb1bd2b63",
  },
  postedAt: "1788957160.308084346",
};

describe("reading one order's state", () => {
  it("reads the live answer", () => {
    const status = decodeStatus(LIVE);
    expect(status?.orderId).toBe("ord_5979205ba2844c258a0defe3cb3a08cf");
    expect(status?.state).toBe("POSTED");
    expect(status?.envelope?.certTag).toBe("cpa-us");
    expect(status?.envelope?.priceTinybars).toBe("100000000");
    expect(status?.envelope?.deadline).toBe("2026-09-14T00:00:00Z");
    expect(status?.postedAt).toBe("1788957160.308084346");
    expect(status?.verdict).toBeNull();
    // Nothing has been signed, so there is nothing to count.
    expect(status?.defectCount).toBeNull();
    // The service cannot see claims, and says so. The screen depends on this.
    expect(status?.claimReadable).toBe(false);
  });

  it("reads a signed verdict and how many issues it carries", () => {
    const status = decodeStatus({
      ...LIVE,
      state: "DELIVERED",
      verdict: "reject",
      signedBy: "0.0.10347668",
      signedAt: "1789043100.000000000",
      attestation: { verdict: "reject", defects: ["D-001", "D-002"] },
    });
    expect(status?.state).toBe("DELIVERED");
    expect(status?.verdict).toBe("reject");
    expect(status?.defectCount).toBe(2);
    expect(status?.signedBy).toBe("0.0.10347668");
  });

  it("takes the verdict off the signed record when the top level omits it", () => {
    const status = decodeStatus({ ...LIVE, attestation: { verdict: "approve", defects: [] } });
    expect(status?.verdict).toBe("approve");
    expect(status?.defectCount).toBe(0);
  });

  it("refuses a verdict it does not recognise rather than showing it", () => {
    const status = decodeStatus({ ...LIVE, verdict: "looks_fine" });
    expect(status?.verdict).toBeNull();
  });

  it("treats an unknown state as unknown, never as posted", () => {
    expect(decodeStatus({ ...LIVE, state: "SETTLED" })?.state).toBe("UNKNOWN");
    expect(decodeStatus({ ...LIVE, state: 7 })?.state).toBe("UNKNOWN");
  });

  it("gives up on an answer with no order in it", () => {
    expect(decodeStatus({ state: "POSTED", claimReadable: true })).toBeNull();
    expect(decodeStatus(null)).toBeNull();
    expect(decodeStatus("POSTED")).toBeNull();
    expect(decodeStatus([LIVE])).toBeNull();
  });

  it("survives an envelope that is not one", () => {
    const status = decodeStatus({ ...LIVE, envelope: "gone" });
    expect(status?.envelope).toBeNull();
    expect(status?.orderId).toBe(LIVE.orderId);
  });

  it("never reports claims as readable on a body that does not say so", () => {
    expect(decodeStatus({ orderId: "ord_x", state: "POSTED" })?.claimReadable).toBe(false);
    expect(decodeStatus({ orderId: "ord_x", state: "POSTED", claimReadable: "yes" })?.claimReadable).toBe(false);
  });
});

describe("the fetch around it", () => {
  const ok = (body: unknown): typeof fetch =>
    (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

  it("asks the right URL and reads the answer", async () => {
    const seen: string[] = [];
    const spy: typeof fetch = (async (url: string) => {
      seen.push(url);
      return new Response(JSON.stringify(LIVE), { status: 200 });
    }) as unknown as typeof fetch;

    const status = await fetchRequestStatus({
      apiUrl: "https://api.example/",
      orderId: LIVE.orderId,
      fetchImpl: spy,
    });
    expect(seen[0]).toBe(`https://api.example/orders/${LIVE.orderId}`);
    expect(status?.state).toBe("POSTED");
  });

  it("answers null on a refusal rather than inventing a state", async () => {
    const missing: typeof fetch = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
    expect(await fetchRequestStatus({ apiUrl: "https://api.example", orderId: "ord_x", fetchImpl: missing })).toBeNull();
  });

  it("answers null when the body is not JSON", async () => {
    const junk: typeof fetch = (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
    expect(await fetchRequestStatus({ apiUrl: "https://api.example", orderId: "ord_x", fetchImpl: junk })).toBeNull();
  });

  it("answers null when the JSON is not a status", async () => {
    expect(
      await fetchRequestStatus({ apiUrl: "https://api.example", orderId: "ord_x", fetchImpl: ok({ error: "no" }) }),
    ).toBeNull();
  });
});
