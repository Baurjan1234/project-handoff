import { describe, expect, it } from "vitest";
import { parseRoute, routePath } from "./router";

describe("routes", () => {
  it("has four, and anything else is the inbox", () => {
    expect(parseRoute("/")).toEqual({ kind: "inbox" });
    expect(parseRoute("/requests")).toEqual({ kind: "requests" });
    expect(parseRoute("/orders/ord_1")).toEqual({ kind: "order", orderId: "ord_1" });
    expect(parseRoute("/orders/ord_1/review")).toEqual({ kind: "workspace", orderId: "ord_1" });
    expect(parseRoute("/settings")).toEqual({ kind: "inbox" });
    expect(parseRoute("/orders/ord_1/other")).toEqual({ kind: "inbox" });
    // Nothing lives under /requests, so a deeper path is not a requests page.
    expect(parseRoute("/requests/ord_1")).toEqual({ kind: "inbox" });
  });

  it("keeps the tab across a reload, which is why it is a path", () => {
    expect(routePath({ kind: "requests" })).toBe("/requests");
    expect(parseRoute(routePath({ kind: "requests" }))).toEqual({ kind: "requests" });
  });

  it("round-trips, including ids that need escaping", () => {
    for (const route of [
      { kind: "inbox" } as const,
      { kind: "requests" } as const,
      { kind: "order", orderId: "ord a/b" } as const,
      { kind: "workspace", orderId: "ord_1" } as const,
    ]) {
      expect(parseRoute(routePath(route))).toEqual(route);
    }
  });

  it("puts the workspace under /orders, which is what Continue navigates to", () => {
    expect(routePath({ kind: "workspace", orderId: "ord_5979205ba2844c258a0defe3cb3a08cf" })).toBe(
      "/orders/ord_5979205ba2844c258a0defe3cb3a08cf/review",
    );
    expect(parseRoute("/ord_5979205ba2844c258a0defe3cb3a08cf/review")).toEqual({ kind: "inbox" });
  });
});

