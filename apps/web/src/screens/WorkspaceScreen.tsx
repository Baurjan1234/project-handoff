import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, FileText } from "lucide-react";
import { SCHEMA_VERSION, type Verdict } from "@handoff/schema";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ChainMode } from "../chain/config";
import { Copyable, shortHash } from "../components/Copyable";
import { DefectsEditor } from "../components/DefectsEditor";
import { HashscanLink } from "../components/HashscanLink";
import { priceWords } from "../components/Money";
import { Mono } from "../components/Mono";
import { NotesEditor } from "../components/NotesEditor";
import { PublishedStatus } from "../components/PublishedStatus";
import type { ExpertIdentity } from "../components/Shell";
import { Stepper, type StepperStep } from "../components/Stepper";
import { VERDICT_WORDS, VerdictPicker } from "../components/VerdictPicker";
import { clockWords, isPast } from "../lib/clock";
import { EMPTY_DRAFT, type Draft, type DraftStore, type WorkspaceStep } from "../lib/draft";
import { countWords, type ExpertOrder } from "../orders/order";
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

function SectionLabel({ children }: { children: string }) {
  return <p className="text-[11px] font-semibold tracking-[0.06em] text-faint uppercase">{children}</p>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2.5">
      <SectionLabel>{title}</SectionLabel>
      {children}
    </section>
  );
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1 text-xs">
      <span className="shrink-0 text-faint">{label}</span>
      <span className="min-w-0 text-right font-medium">{children}</span>
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
  const documentWords = order.documentWords ?? (artifactText === null ? null : countWords(artifactText));
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
  const statusWords = signed ? "Published" : claimExpired ? "Claim expired" : "Under review";

  return (
    <div className="grid lg:h-[calc(100dvh-3.5rem)] lg:grid-rows-[auto_minmax(0,1fr)]">
      {/* The order's own bar: back, title, state, clock, money. */}
      <div className="flex h-[52px] items-center gap-4 border-b border-border bg-card px-4 sm:px-6">
        <Button type="button" variant="ghost" size="sm" className="shrink-0 text-muted-foreground" onClick={onBackToInbox}>
          <ArrowLeft data-icon="inline-start" aria-hidden />
          Inbox
        </Button>
        <span className="h-5 w-px shrink-0 bg-border" aria-hidden />
        <span className="hidden min-w-0 flex-1 truncate font-serif text-sm font-semibold sm:block">{order.title}</span>
        <span className="flex-1 sm:hidden" />
        <div className="flex shrink-0 items-center gap-3">
          <Badge variant="outline" className={signed ? "border-paid/20 bg-paid/5 text-paid" : "border-urgent/20 bg-urgent/5 text-urgent"}>
            {statusWords}
          </Badge>
          <span className="text-xs font-semibold">
            Sign by <span className="tabular-nums">{clockWords(signBy, now)}</span>
          </span>
          <span className="font-mono text-[13px] font-semibold text-paid tabular-nums">{priceWords(order.envelope.price_tinybars)}</span>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] lg:overflow-hidden">
        {/* The paper. It stays. */}
        <section className="border-b border-border lg:overflow-y-auto lg:border-r lg:border-b-0">
          <div className="grid gap-6 px-5 py-6 sm:px-10 sm:py-8">
            <div className="grid gap-2.5">
              <h2 className="font-serif text-2xl leading-tight font-bold tracking-tight">{order.title}</h2>
              <SectionLabel>What the requester is asking</SectionLabel>
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{order.ask}</p>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-faint">
                <span>
                  Credential <span className="font-medium text-muted-foreground">{order.envelope.cert_tag}</span>
                </span>
                <span className="flex items-center gap-1">
                  Order <Copyable value={orderId} display={orderId.length > 16 ? `${orderId.slice(0, 12)}…` : orderId} className="text-[11px]" />
                </span>
                <span className="ml-auto">
                  <HashscanLink kind="topic" id={order.topicId} label="View record" />
                </span>
              </div>
            </div>

            <div className="grid gap-3 border-t border-border pt-6">
              <SectionLabel>Document</SectionLabel>
              <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-4 py-2.5">
                  <span className="flex items-center gap-2 text-[13px] font-semibold">
                    <FileText className="size-3.5" aria-hidden />
                    <Badge variant="destructive">FAKE</Badge>
                    demo document, not a real opinion
                  </span>
                  {documentWords !== null && <span className="text-[11px] text-faint tabular-nums">{documentWords} words</span>}
                </div>
                {artifactText === null ? (
                  <div className="grid gap-2.5 p-8" aria-busy>
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div key={i} className="h-3 animate-pulse rounded bg-muted" style={{ width: `${90 - i * 12}%` }} />
                    ))}
                  </div>
                ) : (
                  <pre className="p-6 font-serif text-sm leading-[1.8] whitespace-pre-wrap sm:p-9">{artifactText}</pre>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* The column. It advances. */}
        <aside className="flex flex-col bg-background lg:overflow-y-auto">
          <div className="grid flex-1 content-start gap-6 px-5 pt-6 pb-4 sm:px-6">
            {!signed && !claimExpired && <Stepper steps={STEPS} current={STEP_INDEX[step]} />}

            {column === "expired" && (
              <div className="grid gap-2 rounded-xl border border-border bg-card p-5 text-sm">
                <p className="font-serif font-semibold">Claim expired · this order is back in the inbox.</p>
                <p className="text-muted-foreground">Your notes are kept — claim it again if nobody else does.</p>
                <Button type="button" variant="outline" className="w-fit rounded-lg" onClick={onBackToInbox}>
                  Back to the inbox
                </Button>
              </div>
            )}

            {column === "notes" && (
              <>
                <Section title="Your notes">
                  <NotesEditor notes={notes} onChange={(n) => update({ notes: n })} disabled={locked} />
                </Section>
                <Section title="Defects">
                  <DefectsEditor
                    defects={defects}
                    onChange={(d) => update({ defects: d })}
                    draft={defectDraft}
                    onDraftChange={setDefectDraft}
                    disabled={locked}
                  />
                </Section>
              </>
            )}

            {column === "verdict" && (
              <>
                <Section title="Your verdict">
                  <VerdictPicker
                    value={verdict}
                    onChange={(v) => {
                      setSoftCheck(false);
                      update({ verdict: v });
                    }}
                    disabled={locked}
                  />
                </Section>
                {softCheck && (
                  <div className="grid gap-3 rounded-xl border border-urgent/30 bg-urgent/5 p-4">
                    <p className="text-[13px]">
                      You listed {defects.length} {defects.length === 1 ? "defect" : "defects"} and chose Approve — continue?
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" className="rounded-lg" onClick={() => goToStep("sign")}>
                        Continue with Approve
                      </Button>
                      <Button type="button" size="sm" variant="outline" className="rounded-lg" onClick={() => setSoftCheck(false)}>
                        Change verdict
                      </Button>
                    </div>
                  </div>
                )}
                <button type="button" className="w-fit text-xs text-faint underline-offset-4 hover:underline" onClick={() => goToStep("notes")}>
                  Back to the notes
                </button>
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

                <Section title="Summary">
                  <div className="grid gap-1 rounded-lg border border-border bg-card p-3">
                    <SummaryRow label="Signing as">
                      <span className="flex flex-wrap items-center justify-end gap-1.5">
                        <Mono className="text-xs">{identity.accountId}</Mono>
                        {identity.credentials.map((tag) => (
                          <Badge key={tag} variant="outline" className="border-primary/20 bg-primary/5 text-[10px] text-primary uppercase">
                            {tag}
                          </Badge>
                        ))}
                      </span>
                    </SummaryRow>

                    <p className="pt-2 text-[10px] font-semibold tracking-[0.06em] text-faint uppercase">Public forever, under your account</p>
                    <SummaryRow label="Verdict">
                      <span className={verdict === "reject" ? "text-destructive" : verdict === "approve" ? "text-paid" : "text-urgent"}>
                        {VERDICT_WORDS[verdict]}
                      </span>
                    </SummaryRow>
                    <SummaryRow label="Defects">
                      {defects.length === 0 ? (
                        <span className="text-muted-foreground">None</span>
                      ) : (
                        <span className="flex flex-wrap justify-end gap-1" aria-label="Defect codes to publish">
                          {defects.map((code) => (
                            <span key={code} className="rounded bg-destructive/10 px-1.5 py-0.5 font-mono text-[11px] text-destructive">
                              {code}
                            </span>
                          ))}
                        </span>
                      )}
                    </SummaryRow>

                    <p className="pt-2 text-[10px] font-semibold tracking-[0.06em] text-faint uppercase">Private · delivered to the requester</p>
                    <SummaryRow label="Your notes">
                      <span className="line-clamp-2 text-left font-normal whitespace-pre-wrap text-muted-foreground">{notes}</span>
                    </SummaryRow>
                    <SummaryRow label="The document">
                      <span className="font-normal text-muted-foreground">{documentWords === null ? "attached" : `${documentWords} words`}</span>
                    </SummaryRow>
                    <SummaryRow label="Notes fingerprint">
                      {notesHash === null ? <span className="text-faint">…</span> : <Copyable value={notesHash} display={shortHash(notesHash)} className="text-[11px]" />}
                    </SummaryRow>

                    <details className="group mt-1 border-t border-border pt-1.5 text-xs">
                      <summary className="cursor-pointer list-none py-1 text-[11px] font-medium text-faint transition-colors hover:text-muted-foreground [&::-webkit-details-marker]:hidden">
                        <span className="group-open:hidden">Show verification details</span>
                        <span className="hidden group-open:inline">Hide verification details</span>
                      </summary>
                      <p className="pt-1 text-[10px] font-semibold tracking-[0.06em] text-faint uppercase">Fingerprints</p>
                      <SummaryRow label="Notes">
                        {notesHash === null ? <span className="text-faint">…</span> : <Copyable value={notesHash} className="text-[11px]" />}
                      </SummaryRow>
                      <SummaryRow label="Document">
                        <Copyable value={order.envelope.artifact_hash_in} className="text-[11px]" />
                      </SummaryRow>
                      <p className="py-1 text-left text-[11px] text-faint">
                        This is the exact document the requester committed to. It cannot change after you sign.
                      </p>
                      <SummaryRow label="Format version">
                        <Mono className="text-[11px]">{String(SCHEMA_VERSION)}</Mono>
                      </SummaryRow>
                      <SummaryRow label="Credential">
                        <Mono className="text-[11px]">{order.envelope.cert_tag}</Mono>
                      </SummaryRow>
                      <SummaryRow label="Record">
                        <span className="flex items-center justify-end gap-2">
                          <Mono className="text-[11px]">{order.topicId}</Mono>
                          <HashscanLink kind="topic" id={order.topicId} label="View" />
                        </span>
                      </SummaryRow>
                    </details>
                  </div>
                </Section>

                {notesBlockers.length > 0 && !locked && (
                  <ul className="grid gap-0.5 text-xs text-muted-foreground">
                    {notesBlockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                )}

                <div className="flex flex-wrap gap-4 text-xs">
                  <button type="button" className="text-faint underline-offset-4 hover:underline" onClick={() => goToStep("verdict")} disabled={locked}>
                    Change verdict
                  </button>
                  <button type="button" className="text-faint underline-offset-4 hover:underline" onClick={() => goToStep("notes")} disabled={locked}>
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
                  <button type="button" className="w-fit text-xs text-faint underline-offset-4 hover:underline" onClick={onBackToInbox}>
                    Back to the inbox
                  </button>
                )}
              </>
            )}
          </div>

          {/* The one action, always in reach. */}
          {!signed && !claimExpired && (
            <div className="sticky bottom-0 grid gap-2 border-t border-border bg-background px-5 pt-4 pb-6 sm:px-6">
              {column === "notes" && (
                <Button
                  type="button"
                  size="lg"
                  className="h-11 w-full rounded-[10px] text-[14px] font-bold hover:bg-azure-hover"
                  disabled={notes.trim() === "" || defectDraft.trim() !== ""}
                  onClick={() => goToStep("verdict")}
                >
                  Continue to verdict
                </Button>
              )}
              {column === "verdict" && !softCheck && (
                <Button
                  type="button"
                  size="lg"
                  className="h-11 w-full rounded-[10px] text-[14px] font-bold hover:bg-azure-hover"
                  disabled={verdict === null}
                  onClick={continueFromVerdict}
                >
                  Continue
                </Button>
              )}
              {column === "sign" && verdict !== null && (
                confirming ? (
                  <>
                    <Button
                      type="button"
                      size="lg"
                      className="h-12 w-full rounded-[10px] bg-paid text-[14px] font-bold hover:bg-paid/90"
                      disabled={!ready}
                      onClick={() => {
                        if (ready) void flow.sign({ order, verdict, defects, notes });
                      }}
                    >
                      {flow.status.kind === "signing" ? "Publishing…" : "Publish forever? · Confirm"}
                    </Button>
                    <div className="flex justify-start">
                      <Button type="button" variant="ghost" size="xs" className="text-muted-foreground" disabled={locked} onClick={() => setConfirming(false)}>
                        Not yet
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      size="lg"
                      className="h-12 w-full rounded-[10px] bg-paid text-[14px] font-bold hover:bg-paid/90"
                      disabled={!ready}
                      onClick={() => setConfirming(true)}
                    >
                      Sign & publish
                    </Button>
                    <p className="text-center text-[11px] leading-snug text-faint">Your name is permanently linked to this verdict.</p>
                  </>
                )
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

export { EMPTY_DRAFT };
