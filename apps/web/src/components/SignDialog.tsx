import type { ElementType, ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import type { Verdict } from "@handoff/schema";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Mono } from "./Mono";
import { VERDICT_WORDS } from "./VerdictPicker";

/**
 * The second ask, and the last one. Claim asks once; Sign always asks again,
 * because this is the only step that cannot be undone.
 *
 * It echoes exactly what will be published, in the same words the summary
 * used: the verdict, how many issues, and the account that will carry it
 * forever. "Go back" is a full-width sibling rather than a whisper, because
 * the wrong choice here is permanent and the right one should not be a
 * gamble on aim.
 *
 * A soft check rides along when the verdict is Approve and issues are
 * listed. It is a question, never a block: the expert may sign anyway.
 */
export function SignConfirm({
  verdict,
  issueCount,
  accountId,
  credentials,
  busy,
  onSign,
  onBack,
  Title = "h2",
  Description = "p",
}: {
  verdict: Verdict;
  issueCount: number;
  accountId: string;
  credentials: readonly string[];
  busy: boolean;
  onSign: () => void;
  onBack: () => void;
  /** The dialog passes Radix's title and description; a test gets plain elements. */
  Title?: ElementType;
  Description?: ElementType;
}) {
  const tone = verdict === "reject" ? "text-destructive" : verdict === "approve" ? "text-paid" : "text-urgent";
  const soft = verdict === "approve" && issueCount > 0;

  return (
    <>
      <span className="mx-auto mb-1 flex size-11 items-center justify-center rounded-full bg-urgent/10 text-urgent" aria-hidden>
        <TriangleAlert className="size-[22px]" />
      </span>
      <Title className="font-serif text-[17px] font-bold">Sign this verdict?</Title>
      <Description className="text-[13px] leading-relaxed text-muted-foreground">
        This verdict will be permanently recorded under your name. It cannot be changed or removed.
      </Description>

      <div className="grid gap-1 rounded-lg bg-background p-3.5 text-left">
        <Row label="Verdict">
          <span className={`font-mono text-[11.5px] font-semibold uppercase ${tone}`}>{VERDICT_WORDS[verdict]}</span>
        </Row>
        <Row label="Issues">
          <span className="font-mono text-[11.5px]">
            {issueCount === 0 ? "None" : `${issueCount} ${issueCount === 1 ? "issue" : "issues"}`}
          </span>
        </Row>
        <Row label="Signed by">
          <span className="flex flex-wrap items-center justify-end gap-1.5">
            <Mono className="text-[11.5px]">{accountId}</Mono>
            {credentials.map((tag) => (
              <span key={tag} className="font-mono text-[10px] text-muted-foreground uppercase">
                {tag}
              </span>
            ))}
          </span>
        </Row>
      </div>

      {soft && (
        <p className="rounded-lg border border-urgent/20 bg-urgent/5 px-3 py-2 text-left text-[12px] leading-snug text-urgent">
          You listed {issueCount} {issueCount === 1 ? "issue" : "issues"} and chose Approve. That is allowed; sign if
          it is what you mean.
        </p>
      )}

      <div className="mt-1 grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" className="h-11 rounded-[10px] text-[13px] font-semibold" disabled={busy} onClick={onBack}>
          Go back
        </Button>
        <Button
          type="button"
          className="h-11 rounded-[10px] bg-paid text-[13px] font-bold hover:bg-paid/90"
          disabled={busy}
          onClick={onSign}
        >
          {busy ? "Publishing…" : "Sign & submit"}
        </Button>
      </div>
    </>
  );
}

export function SignDialog({
  open,
  verdict,
  issueCount,
  accountId,
  credentials,
  busy,
  onSign,
  onBack,
}: {
  open: boolean;
  /** Null when no verdict is chosen, which is when this can never open. */
  verdict: Verdict | null;
  issueCount: number;
  accountId: string;
  credentials: readonly string[];
  busy: boolean;
  onSign: () => void;
  onBack: () => void;
}) {
  if (verdict === null) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // While it is publishing there is nothing to go back to.
        if (!next && !busy) onBack();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="grid w-[380px] max-w-[calc(100vw-2rem)] gap-2 rounded-2xl p-7 pt-8 text-center sm:max-w-[380px]"
      >
        <SignConfirm
          verdict={verdict}
          issueCount={issueCount}
          accountId={accountId}
          credentials={credentials}
          busy={busy}
          onSign={onSign}
          onBack={onBack}
          Title={DialogTitle}
          Description={DialogDescription}
        />
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 py-0.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 justify-self-end text-right">{children}</span>
    </div>
  );
}
