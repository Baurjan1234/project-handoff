/**
 * The requests screen's reads, in one place.
 *
 * Two independent reads, deliberately kept apart. The list comes off the
 * network — this account's own payments into escrow — and is the thing that
 * decides which rows exist. The state of each row comes from the resource
 * server, and a server that is down or slow costs a badge, never a row. So a
 * failed status read leaves the row on screen saying it was not read, and a
 * failed list read leaves the last good list alone.
 *
 * There is no polling loop. A requester opens this to find out where their
 * order got to, and asking again is a click; a timer here would re-read the
 * whole page for no news. `refresh` is exported for the button.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { readMyRequests, type MyRequest } from "./source";
import { fetchRequestStatus, type RequestStatus } from "./status";
import { fetchCertTags, type CertTag } from "./tags";

export interface MyRequestsWiring {
  readonly mirrorNodeUrl: string;
  readonly apiUrl: string;
  readonly requesterAccountId: string;
  readonly escrowAccountId: string;
}

export interface MyRequestsView {
  /** Null while the first read is in flight. */
  readonly requests: readonly MyRequest[] | null;
  readonly statuses: ReadonlyMap<string, RequestStatus | null>;
  readonly tags: readonly CertTag[];
  /** Set when the list itself could not be read. The list stays as it was. */
  readonly failure: string | null;
  readonly refresh: () => void;
}

/** Null wiring means there is nothing real to read, which the screen says. */
export function useMyRequests(wiring: MyRequestsWiring | null): MyRequestsView {
  const [requests, setRequests] = useState<readonly MyRequest[] | null>(null);
  const [statuses, setStatuses] = useState<ReadonlyMap<string, RequestStatus | null>>(new Map());
  const [tags, setTags] = useState<readonly CertTag[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // Whose list this is, kept apart from the read itself. A new wiring means a
  // first read, so the screen goes back to the skeleton; a `refresh` is not a
  // first read, so the rows stay put while it happens. One effect doing both
  // would blank the list every time somebody pressed Check again.
  useEffect(() => {
    setRequests(wiring === null ? [] : null);
  }, [wiring]);

  useEffect(() => {
    if (wiring === null) return;
    const controller = new AbortController();

    void readMyRequests({
      mirrorNodeUrl: wiring.mirrorNodeUrl,
      requesterAccountId: wiring.requesterAccountId,
      escrowAccountId: wiring.escrowAccountId,
      signal: controller.signal,
    }).then(
      (found) => {
        if (controller.signal.aborted) return;
        setRequests(found);
        setFailure(null);
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        // The last good list stays; only the reason is new.
        setRequests((current) => current ?? []);
        setFailure(error instanceof Error ? error.message : "Your requests could not be read.");
      },
    );

    return () => controller.abort();
  }, [wiring, nonce]);

  // The tags the form offers. Read once; a tag added on the server is one
  // reload away, which is the right cost for something that changes rarely.
  useEffect(() => {
    if (wiring === null) return;
    const controller = new AbortController();
    void fetchCertTags({ apiUrl: wiring.apiUrl, signal: controller.signal }).then(
      (found) => {
        if (!controller.signal.aborted) setTags(found);
      },
      () => {
        // No list, so the form says the service listed none.
      },
    );
    return () => controller.abort();
  }, [wiring]);

  // One status read per row, once the rows are known. Each lands on its own,
  // so a slow one never holds up the rest of the page.
  const orderIds = useMemo(() => (requests ?? []).map((r) => r.orderId).join(","), [requests]);

  useEffect(() => {
    if (wiring === null || orderIds === "") return;
    const controller = new AbortController();

    for (const orderId of orderIds.split(",")) {
      void fetchRequestStatus({ apiUrl: wiring.apiUrl, orderId, signal: controller.signal }).then(
        (status) => {
          if (!controller.signal.aborted) setStatuses((current) => new Map(current).set(orderId, status));
        },
        () => {
          if (!controller.signal.aborted) setStatuses((current) => new Map(current).set(orderId, null));
        },
      );
    }

    return () => controller.abort();
  }, [wiring, orderIds]);

  return { requests, statuses, tags, failure, refresh };
}
