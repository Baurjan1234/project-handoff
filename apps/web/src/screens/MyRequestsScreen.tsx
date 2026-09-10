import type { ReactNode } from "react";
import { FileText, Plus, RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copyable } from "../components/Copyable";
import { HashscanLink } from "../components/HashscanLink";
import { Amount } from "../components/Money";
import { Mono } from "../components/Mono";
import { Skeleton } from "../components/Skeleton";
import { clockWords } from "../lib/clock";
import { VERDICT_WORDS } from "../components/VerdictPicker";
import type { MyRequest } from "../requests/source";
import type { RequestStatus } from "../requests/status";

/**
 * "What happened to the work I paid for."
 *
 * The list is not a server's opinion. A row exists because this account's own
 * signed transfer funded the escrow for that order, which is a fact on the
 * network, and the amount shown is the one the escrow was actually credited.
 * The state beside it is a separate, free read of the ordering service.
 *
 * Two things this screen refuses to imply. It never says nobody is reviewing
 * an order — claims are not visible from the service yet and pretending
 * otherwise would be the one lie a requester would act on. And a signed
 * verdict names the account that signed, never "a certified reviewer":
 * certification is an allowlist this week and the honesty rules say so.
 */
export function MyRequestsScreen({
  requests,
  statuses,
  now,
  live = true,
  failure = null,
  onRefresh,
  onNew,
}: {
  /** Null while the first read is in flight. */
  requests: readonly MyRequest[] | null;
  /** What the service says per order. A missing entry is "not read yet". */
  statuses: ReadonlyMap<string, RequestStatus | null>;
  now: Date;
  /** False on the mock chain, where there is no real payment to find. */
  live?: boolean | undefined;
  /** Why the list could not be read. The last good list stays on screen. */
  failure?: string | null | undefined;
  onRefresh?: (() => void) | undefined;
  onNew?: (() => void) | undefined;
}) {
  const claimsUnreadable = [...statuses.values()].some((s) => s !== null && !s.claimReadable);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-[19px] font-bold">My requests</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Work your account paid for, found on the network rather than taken on trust.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onRefresh !== undefined && live && (
            <Button
              type="button"
              variant="outline"
              onClick={onRefresh}
              className="h-9 gap-1.5 rounded-lg text-[13px] font-semibold"
            >
              <RotateCw className="size-3.5" aria-hidden />
              Check again
            </Button>
          )}
          {onNew !== undefined && (
            <Button type="button" onClick={onNew} className="h-9 gap-1.5 rounded-lg text-[13px] font-semibold">
              <Plus className="size-3.5" aria-hidden />
              New request
            </Button>
          )}
        </div>
      </div>

      {failure !== null && failure !== undefined && (
        <p className="rounded-lg border border-urgent/20 bg-urgent/5 px-3.5 py-2.5 text-[12.5px] text-urgent">
          {failure} Anything already found stays below.
        </p>
      )}

      {!live ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          This side reads real payments on the real network, and this app is running on the stand-in
          chain. Connect to the network to see requests your account paid for.
        </p>
      ) : requests === null ? (
        <Loading />
      ) : requests.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          Nothing yet. A request appears here once your account has paid into escrow for one.
        </p>
      ) : (
        <>
          <ul className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            {requests.map((request) => (
              <Row
                key={request.orderId}
                request={request}
                status={statuses.get(request.orderId) ?? null}
                known={statuses.has(request.orderId)}
                now={now}
              />
            ))}
          </ul>
          {claimsUnreadable && (
            <p className="text-[11.5px] text-faint">
              Open means posted and not yet signed. Whether a reviewer is already working on one is
              not visible from here, so an order someone has taken still reads as Open.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * One request. The order id is copyable because it is the one thing a
 * requester hands to something else — the status tool takes it verbatim.
 */
function Row({
  request,
  status,
  known,
  now,
}: {
  request: MyRequest;
  status: RequestStatus | null;
  known: boolean;
  now: Date;
}) {
  const envelope = status?.envelope ?? null;
  const signed = status?.verdict ?? null;

  return (
    <li className="border-b border-border last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-5 py-4">
        <div className="flex min-w-0 flex-1 items-start gap-3.5">
          <FileText className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden />
          <div className="grid min-w-0 flex-1 gap-1.5">
            <Copyable value={request.orderId} className="text-[13px] font-semibold" />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
              {envelope?.certTag !== null && envelope?.certTag !== undefined && (
                <span>For {envelope.certTag}</span>
              )}
              {envelope?.deadline !== null && envelope?.deadline !== undefined && (
                <span>Due {clockWords(envelope.deadline, now)}</span>
              )}
              <span>Paid {clockWords(stampToUtc(request.lockedAt), now)}</span>
              <HashscanLink kind="transaction" id={request.lockTransactionId} label="Your payment" />
            </div>
            {signed !== null && (
              <p className="text-[11.5px] text-muted-foreground">
                Signed by <Mono className="text-[11.5px]">{status?.signedBy ?? "an account"}</Mono>
                {status?.defectCount !== null && status?.defectCount !== undefined && status.defectCount > 0
                  ? ` · ${status.defectCount} ${status.defectCount === 1 ? "issue" : "issues"} listed`
                  : ""}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-4">
          <div className="grid justify-items-end gap-1">
            <Amount tinybars={request.amountTinybars.toString()} className="text-[13px] font-semibold" />
            <span className="text-[10px] text-faint">held for the reviewer</span>
          </div>
          <StateBadge status={status} known={known} />
        </div>
      </div>
    </li>
  );
}

/**
 * The state, in words a requester can act on.
 *
 * `POSTED` is "Open", not "Waiting for a reviewer": the service cannot see
 * claims, so an order somebody is already working on looks exactly like one
 * nobody has touched, and the shorter word does not claim the difference.
 */
function StateBadge({ status, known }: { status: RequestStatus | null; known: boolean }) {
  if (status === null) {
    return (
      <Badge variant="outline" className="text-[10.5px] font-semibold">
        {known ? "Not read" : "…"}
      </Badge>
    );
  }
  if (status.verdict !== null) {
    const tone =
      status.verdict === "reject"
        ? "border-destructive/25 bg-destructive/5 text-destructive"
        : status.verdict === "approve"
          ? "border-paid/25 bg-paid/5 text-paid"
          : "border-urgent/25 bg-urgent/5 text-urgent";
    return (
      <Badge variant="outline" className={`text-[10.5px] font-semibold ${tone}`}>
        {VERDICT_WORDS[status.verdict]}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10.5px] font-semibold">
      {status.state === "POSTED" ? "Open" : status.state === "DELIVERED" ? "Delivered" : "Not read"}
    </Badge>
  );
}

/**
 * The network's timestamp is seconds and nanoseconds; the clock helpers take
 * the envelope's UTC form. Truncated to the second, which is all a person is
 * shown anyway.
 */
export function stampToUtc(stamp: string): string {
  const seconds = Number(stamp.split(".")[0] ?? "0");
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return "";
  return `${new Date(seconds * 1000).toISOString().slice(0, 19)}Z`;
}

/** Rule 3: the shape of the list, not a spinner. */
function Loading() {
  return (
    <div aria-busy role="status">
      <span className="sr-only">Looking for requests your account paid for.</span>
      <ul className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        {[0, 1].map((i) => (
          <li key={i} className="border-b border-border last:border-b-0">
            <div className="flex items-center gap-4 px-5 py-4">
              <div className="grid min-w-0 flex-1 gap-2">
                <Skeleton className="h-4 w-[min(48%,280px)]" delayMs={i * 140} />
                <Skeleton className="h-3 w-56" delayMs={i * 140 + 60} />
              </div>
              <Skeleton className="h-4 w-20" delayMs={i * 140 + 90} />
              <Skeleton className="h-5 w-16 rounded-full" delayMs={i * 140 + 120} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Shared by the screen and the dialog, so both frame a section the same way. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-[11px] font-semibold tracking-[0.06em] text-faint uppercase">{label}</span>
      {children}
    </div>
  );
}
