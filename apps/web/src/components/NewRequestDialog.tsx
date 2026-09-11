import type { ElementType } from "react";
import { ArrowLeft, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { formatTinybars, hbarToTinybars } from "@handoff/schema";
import { Copyable } from "./Copyable";
import { Mono } from "./Mono";
import { Amount } from "./Money";
import type { QuoteOutcome, RequestDraft } from "../requests/create";
import { deadlineForPicker, deadlineFromPicker, handoffVerifyArguments } from "../requests/create";
import type { CertTag } from "../requests/tags";

/**
 * Posting a request, and being straight about where the browser stops.
 *
 * The form asks the real service for a real price. That call is free, needs no
 * key, and comes back with the order id and the escrow the money would go to —
 * so every figure this shows came off the wire rather than out of a mock.
 *
 * Paying is the part this page does not do. It takes two signatures from the
 * requester's own key, and this app holds one key: the connected expert's,
 * for signing verdicts. Putting a requester's spending key in the same browser
 * is the thing `apps/web/CLAUDE.md` rules out, and the signer built for it is
 * server-side by decision. So the last step is handed to the tool that owns
 * it, with the arguments already filled in.
 *
 * Split into a body and a portal wrapper for the same reason as the other two
 * dialogs: a portal renders nothing in a static render, so the body is what
 * the tests can see.
 */
export function NewRequestForm({
  draft,
  onDraft,
  tags,
  problems,
  outcome,
  busy,
  onQuote,
  onClose,
  Title = "h2",
  Description = "p",
}: {
  draft: RequestDraft;
  onDraft: (draft: RequestDraft) => void;
  tags: readonly CertTag[];
  /** Everything wrong with the draft. Empty means the service can be asked. */
  problems: readonly string[];
  /** Null before the first ask. */
  outcome: QuoteOutcome | null;
  busy: boolean;
  onQuote: () => void;
  onClose: () => void;
  Title?: ElementType;
  Description?: ElementType;
}) {
  if (outcome?.kind === "quoted") {
    const { quote } = outcome;
    const price = priceTinybars(draft.priceHbar);
    return (
      <>
        <Title className="flex items-center gap-2 font-serif text-[17px] font-bold">
          <span className="flex size-6 items-center justify-center rounded-full bg-paid/10 text-paid" aria-hidden>
            <Check className="size-3.5" />
          </span>
          Your request is priced
        </Title>
        <Description className="text-[13px] leading-relaxed text-muted-foreground">
          Nothing has been charged and nothing is posted yet. This is the service quoting the
          order and reserving its id.
        </Description>

        <div className="grid gap-1 rounded-lg bg-background p-3.5">
          <QuoteRow label="Order">
            <Copyable value={quote.orderId} className="text-[11.5px] font-semibold" />
          </QuoteRow>
          {price !== null && (
            <QuoteRow label="Held for the reviewer">
              <Amount tinybars={price} className="font-mono text-[11.5px] font-semibold" />
            </QuoteRow>
          )}
          {quote.serviceFeeTinybars !== null && (
            <QuoteRow label="Service fee">
              <Amount tinybars={quote.serviceFeeTinybars} className="font-mono text-[11.5px]" />
            </QuoteRow>
          )}
          <QuoteRow label="Escrow">
            <Mono className="text-[11.5px]">{quote.escrowAccountId}</Mono>
          </QuoteRow>
        </div>

        <div className="grid gap-2 rounded-lg border border-border p-3.5">
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Paying takes two signatures from your own account, and this page does not hold a key
            that can spend your money. Hand these to your agent's <Mono className="text-[11.5px]">handoff_verify</Mono>{" "}
            tool and it pays the fee and locks the order value from the account it is configured with.
          </p>
          <Copyable
            value={handoffVerifyArguments(draft)}
            display="Copy the arguments"
            className="text-[12px] font-semibold"
          />
        </div>

        <div className="mt-1 grid">
          <Button type="button" variant="outline" className="h-10 rounded-[10px] text-[13px] font-semibold" onClick={onClose}>
            Done
          </Button>
        </div>
      </>
    );
  }

  const blocked = problems.length > 0;

  return (
    <>
      <Title className="font-serif text-[17px] font-bold">New request</Title>
      <Description className="text-[13px] leading-relaxed text-muted-foreground">
        Describe the work and what it is worth. The next screen shows the price before anything
        is charged.
      </Description>

      <div className="grid gap-3.5">
        <Labelled label="What should be reviewed?">
          <Textarea
            value={draft.spec}
            onChange={(e) => onDraft({ ...draft, spec: e.target.value })}
            rows={3}
            placeholder="Check the quarterly summary against the filing period."
            className="text-[13px]"
          />
        </Labelled>

        <Labelled label="The work itself">
          <Textarea
            value={draft.artifact}
            onChange={(e) => onDraft({ ...draft, artifact: e.target.value })}
            rows={4}
            placeholder="Paste the document. Use fabricated content only."
            className="font-mono text-[12px]"
          />
          <p className="text-[11px] text-faint">
            Stored under its fingerprint and delivered to the reviewer. Only the fingerprint is
            published.
          </p>
        </Labelled>

        <Labelled label="Who should review it?">
          {tags.length === 0 ? (
            <p className="text-[12px] text-faint">The service has not listed any reviewers.</p>
          ) : (
            <RadioGroup
              value={draft.certTag}
              onValueChange={(next) => onDraft({ ...draft, certTag: next })}
              aria-label="Reviewer"
              className="grid gap-1.5"
            >
              {tags.map((tag) => (
                <label
                  key={tag.code}
                  htmlFor={`tag-${tag.code}`}
                  className="flex cursor-pointer items-center gap-2.5 rounded-[10px] border-2 border-border bg-card px-3 py-2.5 transition select-none hover:border-faint has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                >
                  <RadioGroupItem id={`tag-${tag.code}`} value={tag.code} />
                  <span className="grid">
                    <span className="text-[13px] font-semibold">{tag.label}</span>
                    <Mono className="text-[10.5px] text-faint">{tag.code}</Mono>
                  </span>
                </label>
              ))}
            </RadioGroup>
          )}
        </Labelled>

        <div className="grid grid-cols-2 gap-3">
          <Labelled label="Worth (HBAR)">
            <Input
              value={draft.priceHbar}
              onChange={(e) => onDraft({ ...draft, priceHbar: e.target.value })}
              inputMode="decimal"
              className="font-mono text-[13px]"
            />
          </Labelled>
          <Labelled label="Claim window (seconds)">
            <Input
              value={draft.claimTimeoutSeconds}
              onChange={(e) => onDraft({ ...draft, claimTimeoutSeconds: e.target.value })}
              inputMode="numeric"
              className="font-mono text-[13px]"
            />
          </Labelled>
        </div>

        <Labelled label="Deadline">
          <Input
            type="datetime-local"
            value={deadlineForPicker(draft.deadline)}
            onChange={(e) => onDraft({ ...draft, deadline: deadlineFromPicker(e.target.value) })}
            className="font-mono text-[13px]"
          />
          {draft.deadline !== "" && (
            <p className="text-[11px] text-faint">
              Your own time zone. The order carries <Mono className="text-[10.5px]">{draft.deadline}</Mono>.
            </p>
          )}
        </Labelled>
      </div>

      {outcome !== null && (
        <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-[12px] leading-snug text-destructive">
          {outcome.message}
        </p>
      )}

      {blocked && (
        <ul className="grid gap-1 rounded-lg border border-urgent/20 bg-urgent/5 px-3 py-2 text-[12px] leading-snug text-urgent">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      <div className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-10 gap-1.5 rounded-[10px] text-[13px] font-semibold"
          disabled={busy}
          onClick={onClose}
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Back
        </Button>
        <Button
          type="button"
          className="h-10 rounded-[10px] text-[13px] font-bold"
          disabled={busy || blocked}
          onClick={onQuote}
        >
          {busy ? "Asking…" : "Get the price"}
        </Button>
      </div>
    </>
  );
}

/**
 * The order value in tinybars, for the amount display.
 *
 * Delegated to the schema's money module, which is the only thing in the repo
 * that converts HBAR. The form has already refused anything that is not an
 * amount, so the catch is for the render that happens between a keystroke and
 * the next validation rather than for a real case.
 */
function priceTinybars(priceHbar: string): string | null {
  try {
    return formatTinybars(hbarToTinybars(priceHbar.trim()));
  } catch {
    return null;
  }
}

export function NewRequestDialog({
  open,
  onOpenChange,
  ...body
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
} & Parameters<typeof NewRequestForm>[0]) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="grid max-h-[calc(100dvh-3rem)] w-[440px] max-w-[calc(100vw-2rem)] gap-2.5 overflow-y-auto rounded-2xl p-6 sm:max-w-[440px]"
      >
        <NewRequestForm {...body} Title={DialogTitle} Description={DialogDescription} />
      </DialogContent>
    </Dialog>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-[11px] font-semibold tracking-[0.06em] text-faint uppercase">{label}</span>
      {children}
    </div>
  );
}

function QuoteRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 py-0.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 justify-self-end text-right">{children}</span>
    </div>
  );
}
