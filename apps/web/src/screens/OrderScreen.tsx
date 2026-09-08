import { ArrowLeft } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Escrow } from "../components/Money";
import { Mono } from "../components/Mono";
import { ProofRow } from "../components/ProofRow";
import { claimRefusal, claimWindowWords, clockWords } from "../lib/clock";
import type { ClaimState, ExpertOrder } from "../orders/order";
import type { ClaimFlow } from "../orders/useClaimFlow";

/**
 * "Take it, or learn I lost." The same facts as the row, plus what the
 * requester is asking, from the content store. The document is not here:
 * it opens after a confirmed claim, because showing it to a non-claimant
 * would leak access-controlled content.
 *
 * Claim asks once. After the click the status reads Confirming, the same
 * labeled state as payout, then Claimed · yours to review, or Someone else
 * claimed this. The workspace opens only on a confirmed claim. Losing is an
 * ordinary outcome: the button is replaced, nothing reddens.
 */
export function OrderScreen({
  order,
  claim,
  flow,
  now,
  onBack,
  onOpenWorkspace,
}: {
  order: ExpertOrder;
  /** What the mirror said when the inbox was read. */
  claim: ClaimState;
  flow: ClaimFlow;
  now: Date;
  onBack: () => void;
  onOpenWorkspace: () => void;
}) {
  const { envelope } = order;
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const refusal = claimRefusal(envelope.deadline, nowSeconds);

  const decided = flow.status.kind === "decided" ? flow.status.confirmation : null;
  const confirmedYours =
    (decided?.phase === "yours" && decided.state?.kind === "yours" ? decided.state : null) ??
    (claim.kind === "yours" ? claim : null);
  const lost = decided?.phase === "someone-else" || (claim.kind === "someone-else" && decided === null);
  const confirming = flow.status.kind === "confirming";
  const stalled = decided?.phase === "stalled";

  return (
    <div className="grid gap-6">
      <Button type="button" variant="ghost" size="sm" className="w-fit text-muted-foreground" onClick={onBack}>
        <ArrowLeft data-icon="inline-start" aria-hidden />
        Inbox
      </Button>

      <section className="grid gap-5 rounded-2xl border border-border/60 bg-card p-5 shadow-xs sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-1">
            <h2 className="text-xl font-semibold tracking-tight">{order.title}</h2>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                Open until <span className="text-foreground">{clockWords(envelope.deadline, now)}</span>
              </span>
              <span>{claimWindowWords(envelope.claim_timeout_seconds)}</span>
              <span className="tabular-nums">{order.documentWords} words</span>
            </div>
          </div>
          <Escrow priceTinybars={envelope.price_tinybars} size="lg" />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Required credential:</span>
          <Badge variant="outline">{envelope.cert_tag}</Badge>
          <span className="text-muted-foreground">· Paid whatever the verdict is.</span>
        </div>

        <div className="grid gap-2 border-t border-border/60 pt-5">
          <h3 className="text-sm font-semibold">What the requester is asking</h3>
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{order.ask}</p>
          <p className="text-xs text-muted-foreground">The document opens after you claim.</p>
        </div>

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Details</summary>
          <dl className="grid gap-x-4 gap-y-1 pt-2 sm:grid-cols-[8rem_1fr]">
            <dt>Order</dt>
            <dd>
              <Mono>{envelope.order_id}</Mono>
            </dd>
            <dt>Escrow account</dt>
            <dd>
              <Mono>{order.escrowAccountId}</Mono>
            </dd>
          </dl>
        </details>
      </section>

      <section className="grid gap-3" aria-live="polite">
        {flow.status.kind === "error" && (
          <Alert variant="destructive">
            <AlertTitle>Not claimed</AlertTitle>
            <AlertDescription>{flow.status.message}. Nothing was sent; you can try again.</AlertDescription>
          </Alert>
        )}

        {confirmedYours !== null ? (
          <>
            <p className="text-lg font-semibold tracking-tight">Claimed · yours to review</p>
            <p className="text-sm text-muted-foreground">
              Sign by <span className="text-foreground">{clockWords(confirmedYours.signBy, now)}</span>
            </p>
            <Button type="button" size="lg" className="h-11 w-full rounded-xl" onClick={onOpenWorkspace}>
              Open the document
            </Button>
            <p className="text-xs text-muted-foreground">
              Changed your mind? Do nothing — this returns to the inbox at {clockWords(confirmedYours.signBy, now)}.
              Your notes are kept.
            </p>
          </>
        ) : lost ? (
          <p className="rounded-xl bg-muted/50 p-4 text-sm">Someone else claimed this.</p>
        ) : confirming ? (
          <>
            <p className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <span className="size-2 animate-pulse rounded-full bg-foreground/60" aria-hidden />
              Confirming
            </p>
            <p className="text-sm text-muted-foreground">Waiting for the network to confirm who was first. A few seconds.</p>
            <ProofRow transactionId={flow.status.confirmation?.claimTransactionId ?? null} reserved />
          </>
        ) : stalled ? (
          <>
            <p className="text-lg font-semibold tracking-tight">Still confirming</p>
            <p className="text-sm text-muted-foreground">
              The network has not answered yet. Your claim was sent and stands; nothing is re-sent.
            </p>
            <Button type="button" variant="outline" className="w-fit rounded-xl" onClick={flow.checkAgain}>
              Check again
            </Button>
          </>
        ) : refusal !== null ? (
          <p className="rounded-xl bg-muted/50 p-4 text-sm">{refusal}</p>
        ) : (
          <>
            <Button
              type="button"
              size="lg"
              className="h-11 w-full rounded-xl"
              onClick={() => {
                void flow.claim(order);
              }}
            >
              Claim
            </Button>
            <p className="text-xs text-muted-foreground">
              {claimWindowWords(envelope.claim_timeout_seconds)}, never past {clockWords(envelope.deadline, now)}.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
