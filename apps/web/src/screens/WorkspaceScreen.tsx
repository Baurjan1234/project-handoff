import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Verdict } from "@handoff/schema";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ChainMode } from "../chain/config";
import { DefectsEditor } from "../components/DefectsEditor";
import { Mono, ShortHash } from "../components/Mono";
import { NotesEditor } from "../components/NotesEditor";
import { PublishedStatus } from "../components/PublishedStatus";
import { Stepper, type StepperStep } from "../components/Stepper";
import { VERDICT_WORDS, VerdictPicker } from "../components/VerdictPicker";
import type { ExpertIdentity } from "../components/Shell";
import { clockWords, isPast } from "../lib/clock";
import { EMPTY_DRAFT, type Draft, type DraftStore, type WorkspaceStep } from "../lib/draft";
import type { ExpertOrder } from "../orders/order";
import { hashNotes } from "../sign/notes";
import { previewAttestation } from "../sign/preview";
import { describeError } from "../sign/runSign";
import type { SignFlow } from "../sign/useSignFlow";

const STEPS: readonly StepperStep[] = [
  { label: "Notes", hint: "What you found" },
  { label: "Verdict", hint: "One of three" },
  { label: "Sign", hint: "Your name on it" },
];
const STEP_INDEX: Record<WorkspaceStep, number> = { notes: 1, verdict: 2, sign: 3 };

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-3 rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
      <div className="grid gap-0.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint !== undefined && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

/**
 * "Judge this document." The document on the left never disappears once
 * opened; the column on the right advances: notes and defects, then the
 * verdict, then the sign summary, then the stamp and payment, all beside
 * the paper. The brief and the clock ride along at the top of the column,
 * so the expert never goes back for them.
 */
export function WorkspaceScreen({
  mode,
  identity,
  order,
  signBy,
  artifactText,
  flow,
  now,
  drafts,
  onBackToInbox,
  initialDefectDraft = "",
}: {
  mode: ChainMode;
  identity: ExpertIdentity;
  order: ExpertOrder;
  /** From the confirmed claim. Never past the order deadline. */
  signBy: string;
  /** Null while the document is still arriving. */
  artifactText: string | null;
  flow: SignFlow;
  now: Date;
  drafts: DraftStore;
  onBackToInbox: () => void;
  /** For tests: a defect code typed but not yet added. */
  initialDefectDraft?: string;
}) {
  const orderId = order.envelope.order_id;
  const [draft, setDraft] = useState<Draft>(() => drafts.load(orderId));
  const [defectDraft, setDefectDraft] = useState(initialDefectDraft);
  const [notesHash, setNotesHash] = useState<string | null>(null);
  const [hashError, setHashError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [softCheck, setSoftCheck] = useState(false);

  const { notes, defects, verdict, step } = draft;
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const signed = flow.status.kind === "signed";
  const locked = flow.status.kind !== "idle" && flow.status.kind !== "error";

  // The draft is the order's, not the screen's. Kept until signed.
  useEffect(() => {
    if (signed) drafts.clear(orderId);
    else drafts.save(orderId, draft);
  }, [draft, drafts, orderId, signed]);

  // The fingerprint the screen shows is the one that gets published: same function.
  useEffect(() => {
    let live = true;
    hashNotes(notes).then(
      ({ hash }) => {
        if (!live) return;
        setNotesHash(hash);
        setHashError(null);
      },
      (error: unknown) => {
        if (!live) return;
        setNotesHash(null);
        setHashError(describeError(error));
      },
    );
    return () => {
      live = false;
    };
  }, [notes]);

  const preview = useMemo(
    () => (verdict === null || notesHash === null ? null : previewAttestation(order.envelope, { verdict, defects, notesHash })),
    [order, verdict, defects, notesHash],
  );

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const claimExpired = !signed && !locked && isPast(signBy, nowSeconds);

  const notesBlockers: string[] = [];
  if (notes.trim() === "") notesBlockers.push("Write your notes. They are what the requester paid for.");
  if (defectDraft.trim() !== "") notesBlockers.push("Add or clear the defect code you typed.");
  if (preview !== null) notesBlockers.push(...preview.problems);
  if (hashError !== null) notesBlockers.push(hashError);

  const ready = !locked && notesBlockers.length === 0 && verdict !== null && preview !== null && preview.body !== null;

  const goToStep = (next: WorkspaceStep) => {
    setConfirming(false);
    setSoftCheck(false);
    update({ step: next });
  };

  const continueFromVerdict = () => {
    if (verdict === null) return;
    if (verdict === "approve" && defects.length > 0 && !softCheck) {
      setSoftCheck(true);
      return;
    }
    goToStep("sign");
  };

  const column = signed ? "published" : claimExpired ? "expired" : step;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
      <section className="grid gap-0 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-xs lg:sticky lg:top-4">
        <div className="flex items-center gap-2 border-b border-border/60 bg-destructive/10 px-5 py-2 text-xs font-semibold text-destructive">
          <Badge variant="destructive">FAKE</Badge>
          demo document, not a real opinion
        </div>
        {artifactText === null ? (
          <div className="grid gap-2 p-5" aria-busy>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-3 animate-pulse rounded bg-muted" style={{ width: `${90 - i * 12}%` }} />
            ))}
          </div>
        ) : (
          <pre className="max-h-[70dvh] overflow-auto p-5 font-mono text-[0.8125rem] leading-relaxed whitespace-pre-wrap">
            {artifactText}
          </pre>
        )}
      </section>

      <div className="grid gap-5">
        <div className="grid gap-3 rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
          <div className="grid gap-1">
            <h2 className="text-base font-semibold tracking-tight">{order.title}</h2>
            <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">What the requester is asking</p>
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{order.ask}</p>
          </div>
          <p className="text-sm">
            Sign by <span className="font-semibold">{clockWords(signBy, now)}</span>
          </p>
          {!signed && <Stepper steps={STEPS} current={claimExpired ? 1 : STEP_INDEX[step]} />}
        </div>

        {column === "expired" && (
          <div className="grid gap-2 rounded-2xl bg-muted/50 p-5 text-sm">
            <p className="font-semibold">Claim expired · this order is back in the inbox.</p>
            <p className="text-muted-foreground">Your notes are kept — claim it again if nobody else does.</p>
            <Button type="button" variant="outline" className="w-fit rounded-xl" onClick={onBackToInbox}>
              Back to the inbox
            </Button>
          </div>
        )}

        {column === "notes" && (
          <>
            <Card title="Notes" hint="What you checked, what you found, why.">
              <NotesEditor notes={notes} onChange={(n) => update({ notes: n })} disabled={locked} />
            </Card>
            <Card title="Defects" hint="Short codes. The reasoning goes in the notes.">
              <DefectsEditor
                defects={defects}
                onChange={(d) => update({ defects: d })}
                draft={defectDraft}
                onDraftChange={setDefectDraft}
                disabled={locked}
              />
            </Card>
            <Button
              type="button"
              size="lg"
              className="h-11 w-full rounded-xl"
              disabled={notes.trim() === "" || defectDraft.trim() !== ""}
              onClick={() => goToStep("verdict")}
            >
              Continue to verdict
            </Button>
          </>
        )}

        {column === "verdict" && (
          <>
            <Card title="Verdict">
              <VerdictPicker
                value={verdict}
                onChange={(v) => {
                  setSoftCheck(false);
                  update({ verdict: v });
                }}
                disabled={locked}
              />
            </Card>
            {softCheck ? (
              <div className="grid gap-3 rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
                <p className="text-sm">
                  You listed {defects.length} {defects.length === 1 ? "defect" : "defects"} and chose Approve — continue?
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" className="rounded-xl" onClick={() => goToStep("sign")}>
                    Continue with Approve
                  </Button>
                  <Button type="button" variant="outline" className="rounded-xl" onClick={() => setSoftCheck(false)}>
                    Change verdict
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                size="lg"
                className="h-11 w-full rounded-xl"
                disabled={verdict === null}
                onClick={continueFromVerdict}
              >
                Continue
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" className="w-fit text-muted-foreground" onClick={() => goToStep("notes")}>
              Back to the notes
            </Button>
          </>
        )}

        {column === "sign" && verdict !== null && (
          <>
            {flow.status.kind === "error" && (
              <Alert variant="destructive">
                <AlertTitle>Not published</AlertTitle>
                <AlertDescription>{flow.status.message}</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-4 rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">Signing as</span>
                <Mono>{identity.accountId}</Mono>
                {identity.credentials.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </p>

              <div className="grid gap-1 border-t border-border/60 pt-4">
                <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">Public forever, under your account</p>
                <p className="text-base font-semibold">{VERDICT_WORDS[verdict]}</p>
                {defects.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No defect codes.</p>
                ) : (
                  <ul className="flex flex-wrap gap-2" aria-label="Defect codes to publish">
                    {defects.map((code) => (
                      <li key={code} className="rounded-full bg-muted px-3 py-1 font-mono text-xs">
                        {code}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="grid gap-1 border-t border-border/60 pt-4">
                <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">Private · delivered to the requester</p>
                <p className="line-clamp-3 text-sm whitespace-pre-wrap text-muted-foreground">{notes}</p>
                <p className="text-sm text-muted-foreground">The document, {order.documentWords} words.</p>
              </div>

              <details className="border-t border-border/60 pt-3 text-xs text-muted-foreground">
                <summary className="cursor-pointer">Fingerprints</summary>
                <dl className="grid gap-x-4 gap-y-1 pt-2 sm:grid-cols-[7rem_1fr]">
                  <dt>Notes</dt>
                  <dd>{notesHash === null ? "…" : <ShortHash value={notesHash} />}</dd>
                  <dt>Document</dt>
                  <dd className="grid gap-0.5">
                    <ShortHash value={order.envelope.artifact_hash_in} />
                    <span>This is the exact document the requester committed to. It cannot change after you sign.</span>
                  </dd>
                </dl>
              </details>
            </div>

            {notesBlockers.length > 0 && !locked && (
              <ul className="grid gap-0.5 text-xs text-muted-foreground">
                {notesBlockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}

            {confirming ? (
              <div className="grid gap-3">
                <Button
                  type="button"
                  size="lg"
                  className="h-12 w-full rounded-xl text-base"
                  disabled={!ready}
                  onClick={() => {
                    if (ready) void flow.sign({ order, verdict, defects, notes });
                  }}
                >
                  {flow.status.kind === "signing" ? "Publishing…" : "Publish forever? · Confirm"}
                </Button>
                <div className="flex justify-start">
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground"
                    disabled={locked}
                    onClick={() => setConfirming(false)}
                  >
                    Not yet
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                size="lg"
                className="h-12 w-full rounded-xl text-base"
                disabled={!ready}
                onClick={() => setConfirming(true)}
              >
                Sign & publish
              </Button>
            )}

            <div className="flex flex-wrap gap-4 text-xs">
              <button type="button" className="text-muted-foreground underline-offset-4 hover:underline" onClick={() => goToStep("verdict")} disabled={locked}>
                Change verdict
              </button>
              <button type="button" className="text-muted-foreground underline-offset-4 hover:underline" onClick={() => goToStep("notes")} disabled={locked}>
                Back to the document
              </button>
            </div>
          </>
        )}

        {column === "published" && flow.status.kind === "signed" && flow.settlement !== null && (
          <>
            <PublishedStatus
              mode={mode}
              order={order}
              expertAccountId={identity.accountId}
              signed={flow.status.signed}
              settlement={flow.settlement}
              platformIssue={flow.platformIssue}
              onCheckAgain={flow.checkAgain}
            />
            {flow.settlement.phase === "settled" && (
              <Button type="button" variant="ghost" size="sm" className="w-fit text-muted-foreground" onClick={onBackToInbox}>
                Back to the inbox
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export { EMPTY_DRAFT };
