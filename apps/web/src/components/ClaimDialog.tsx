import type { ElementType, ReactNode } from "react";
import { Check, Clock, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { claimWindowWords, clockWords } from "../lib/clock";
import type { ExpertOrder } from "../orders/order";
import type { ClaimFlow } from "../orders/useClaimFlow";
import { Amount } from "./Money";
import { ProofRow } from "./ProofRow";

/**
 * The claim, reported while it happens. Three outcomes and nothing invented:
 * Confirming while the network is asked, then the order is yours, or it is
 * not. Losing is an ordinary outcome, so it is amber and calm, never red,
 * and it says what actually happens next under the claim rule: the holder's
 * window runs out and the order returns to the inbox once, where anyone
 * including this expert may claim it again. There is no queue in the
 * protocol, so this never promises a position in one.
 *
 * `ClaimReport` is the body, and it is where the words live. `ClaimDialog`
 * only puts it in a dialog: Radix renders that through a portal, which a
 * server render cannot see, so the states are tested through the body.
 */
export function ClaimReport({
  order,
  flow,
  now,
  onOpenWorkspace,
  onClose,
  Title = "h2",
  Description = "p",
}: {
  order: ExpertOrder;
  flow: ClaimFlow;
  now: Date;
  onOpenWorkspace: () => void;
  onClose: () => void;
  /** The dialog passes Radix's title and description; a test gets plain elements. */
  Title?: ElementType;
  Description?: ElementType;
}) {
  const decided = flow.status.kind === "decided" ? flow.status.confirmation : null;
  const yours = decided?.phase === "yours" && decided.state?.kind === "yours" ? decided.state : null;
  const lost = decided?.phase === "someone-else";
  const stalled = decided?.phase === "stalled";
  const failed = flow.status.kind === "error" ? flow.status.message : null;

  if (yours !== null) {
    return (
      <>
        <Icon tone="paid">
          <Check className="size-6" strokeWidth={2.5} aria-hidden />
        </Icon>
        <Title className="font-serif text-[17px] font-semibold">Review claimed</Title>
        <Description className="text-[13px] leading-relaxed text-muted-foreground">
          You have until the deadline to deliver your verdict. Take your time, be thorough.
        </Description>
        <Detail label="Sign by" value={clockWords(yours.signBy, now)} />
        <Button type="button" size="lg" className="mt-2 h-11 w-full rounded-[10px] text-[14px] font-bold hover:bg-azure-hover" onClick={onOpenWorkspace}>
          Start reviewing
        </Button>
      </>
    );
  }

  if (lost) {
    return (
      <>
        <Icon tone="urgent">
          <Clock className="size-[22px]" aria-hidden />
        </Icon>
        <Title className="font-serif text-[17px] font-semibold">Another expert was faster</Title>
        <Description className="text-[13px] leading-relaxed text-muted-foreground">
          The network's clock decides who was first, and theirs landed sooner. If they do not deliver in time the
          review returns to the inbox, and you can claim it again.
        </Description>
        <Detail label="Their window" value={claimWindowWords(order.envelope.claim_timeout_seconds).replace(" after you claim", "")} />
        <Detail label="Open until" value={clockWords(order.envelope.deadline, now)} />
        <Button type="button" variant="outline" size="lg" className="mt-2 h-11 w-full rounded-[10px] text-[14px] font-semibold" onClick={onClose}>
          Back to the inbox
        </Button>
      </>
    );
  }

  if (stalled) {
    return (
      <>
        <Icon tone="urgent">
          <Clock className="size-[22px]" aria-hidden />
        </Icon>
        <Title className="font-serif text-[17px] font-semibold">Still confirming</Title>
        <Description className="text-[13px] leading-relaxed text-muted-foreground">
          The network has not answered yet. Your claim was sent and stands; nothing is re-sent.
        </Description>
        <Button type="button" variant="outline" size="lg" className="mt-2 h-11 w-full rounded-[10px] text-[14px] font-semibold" onClick={flow.checkAgain}>
          Check again
        </Button>
      </>
    );
  }

  if (failed !== null) {
    return (
      <>
        <Icon tone="urgent">
          <Clock className="size-[22px]" aria-hidden />
        </Icon>
        <Title className="font-serif text-[17px] font-semibold">Not claimed</Title>
        <Description className="text-[13px] leading-relaxed text-muted-foreground">
          {failed}. Nothing was sent; you can try again.
        </Description>
        <Button type="button" variant="outline" size="lg" className="mt-2 h-11 w-full rounded-[10px] text-[14px] font-semibold" onClick={onClose}>
          Close
        </Button>
      </>
    );
  }

  return (
    <>
      <Icon tone="primary">
        <LoaderCircle className="size-[22px] animate-spin" aria-hidden />
      </Icon>
      <Title className="font-serif text-[17px] font-semibold">Claiming review…</Title>
      <Description className="text-[13px] leading-relaxed text-muted-foreground">
        Submitting your claim. This takes a few seconds.
      </Description>
      <Detail label="Order" value={order.title.replace(/^Order /, "")} mono={false} />
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-lg bg-background px-3 py-2 text-left text-xs">
        <span className="text-muted-foreground">Payment</span>
        <span className="justify-self-end">
          <Amount tinybars={order.envelope.price_tinybars} className="font-mono text-[11.5px] font-semibold text-paid" />
        </span>
      </div>
      <ProofRow transactionId={flow.status.kind === "confirming" ? (flow.status.confirmation?.claimTransactionId ?? null) : null} reserved />
    </>
  );
}

export function ClaimDialog({
  order,
  flow,
  now,
  onOpenWorkspace,
  onClose,
}: {
  /** The order being claimed. Null when nothing is in flight. */
  order: ExpertOrder | null;
  flow: ClaimFlow;
  now: Date;
  onOpenWorkspace: () => void;
  onClose: () => void;
}) {
  if (order === null) return null;
  const open = flow.status.kind !== "idle";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent showCloseButton className="grid w-[360px] max-w-[calc(100vw-2rem)] gap-2 rounded-2xl p-7 pt-8 text-center sm:max-w-[360px]">
        <ClaimReport
          order={order}
          flow={flow}
          now={now}
          onOpenWorkspace={onOpenWorkspace}
          onClose={onClose}
          Title={DialogTitle}
          Description={DialogDescription}
        />
      </DialogContent>
    </Dialog>
  );
}

function Icon({ tone, children }: { tone: "primary" | "paid" | "urgent"; children: ReactNode }) {
  const tones = {
    primary: "bg-primary/10 text-primary",
    paid: "bg-paid/10 text-paid",
    urgent: "bg-urgent/10 text-urgent",
  } as const;
  return (
    <span className={`mx-auto mb-1 flex size-12 items-center justify-center rounded-full ${tones[tone]}`} aria-hidden>
      {children}
    </span>
  );
}

/**
 * One line of the dialog. Two bounded columns rather than a flex row: a
 * grid item defaults to min-width auto, so an unbroken order id would push
 * the whole card wider than its box, which is what it did.
 */
function Detail({ label, value, mono = true, tone }: { label: string; value: string; mono?: boolean; tone?: "paid" }) {
  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-lg bg-background px-3 py-2 text-left text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`truncate text-right font-medium ${mono ? "font-mono text-[11.5px]" : ""} ${tone === "paid" ? "text-paid" : ""}`} title={value}>
        {value}
      </span>
    </div>
  );
}
