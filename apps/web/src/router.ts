/**
 * Three routes, and everything else is state rendered inside them. The
 * order id is in the URL so a refresh lands where the expert was and a
 * specific order is deep-linkable, which the recording will want. Three
 * routes do not justify a router library.
 */

import { useCallback, useEffect, useState } from "react";

export type Route =
  | { readonly kind: "inbox" }
  | { readonly kind: "order"; readonly orderId: string }
  | { readonly kind: "workspace"; readonly orderId: string };

export function parseRoute(pathname: string): Route {
  const parts = pathname.split("/").filter((p) => p.length > 0);
  if (parts[0] === "orders" && parts[1] !== undefined) {
    const orderId = decodeURIComponent(parts[1]);
    if (parts[2] === "review") return { kind: "workspace", orderId };
    if (parts[2] === undefined) return { kind: "order", orderId };
  }
  return { kind: "inbox" };
}

export function routePath(route: Route): string {
  switch (route.kind) {
    case "inbox":
      return "/";
    case "order":
      return `/orders/${encodeURIComponent(route.orderId)}`;
    case "workspace":
      return `/orders/${encodeURIComponent(route.orderId)}/review`;
  }
}

export function useRoute(): readonly [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((next: Route) => {
    const path = routePath(next);
    if (path !== window.location.pathname) window.history.pushState(null, "", path);
    setRoute(next);
  }, []);

  return [route, navigate];
}
