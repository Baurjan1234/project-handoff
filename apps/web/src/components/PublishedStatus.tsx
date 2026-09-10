import { Button } from "@/components/ui/button";
import type { ChainMode } from "../chain/config";
import { MIRROR_EXPECTED_LAG_MS, type SettlementState } from "../sign/settlement";
import type { OrderForSigning, SignedAttestation } from "../sign/sign";
import { Amount } from "./Money";
import { Mono } from "./Mono";
import { ProofRow } from "./ProofRow";

/** The stamp. Receipt first, permanence second. */
export const PUBLISHED_STAMP = "Published · signed by you, attributable forever";

function seconds(ms: number): string {
  return `${Math.floor(ms / 1000)} s`;
}

function Label({ children }: { children: string }) {
  return <p className="text-[11px] font-semibold tracking-[0.06em] text-faint uppercase">{children}</p>;
}

/**
 * What the expert sees after the sign, on the same screen, in the same
 * column: the stamp with its proof, then payment. Payment is Confirming
 * until the network's read says Paid; after a minute of silence it is
 * "Published · payment pending", never an endless pulse. A read that fails
 * is mentioned and read again. Only the format-check failure is an error,
 * and it carries a next step.
 */
export function PublishedStatus({
  mode,
  order,
  expertAccountId,
  signed,
  settlement,
  platformIssue,
  onCheckAgain,
}: {
  mode: ChainMode;
  order: OrderForSigning;
  expertAccountId: string;
  signed: SignedAttestation;
  settlement: SettlementState;
  platformIssue: string | null;
  onCheckAgain: () => void;
}) {
  const expected = Math.round(MIRROR_EXPECTED_LAG_MS / 1000);
  const verdictSeen = settlement.attestation?.status === "SUCCESS";
  const paid = settlement.phase === "settled" && settlement.payout !== null;
  const failed = settlement.phase === "failed";
  const pending = settlement.phase === "stalled";

  return (
    <section className="grid gap-4" aria-live="polite">
      <div className="grid gap-2 rounded-xl border border-border bg-card p-4">
        <Label>Published</Label>
        <p className="font-serif text-lg leading-tight font-semibold tracking-tight">{PUBLISHED_STAMP}</p>
        <p className="text-xs text-muted-foreground">
          From your account <Mono className="text-xs">{expertAccountId}</Mono>, at <Mono className="text-xs">{signed.consensusTimestamp}</Mono>.
        </p>
        <ProofRow transactionId={signed.transactionId} />
      </div>

      <div className="grid gap-2 rounded-xl border border-border bg-card p-4">
        <Label>Payment</Label>
        {paid && settlement.payout !== null ? (
          <>
            <p className="text-lg font-semibold tracking-tight tabular-nums">
              <span className="font-mono text-paid">
                Paid · <Amount tinybars={order.envelope.price_tinybars} className="font-mono text-paid" />
              </span>{" "}
              <span className="font-normal text-muted-foreground">to your account</span>{" "}
              <Mono className="text-base">{expertAccountId}</Mono>
            </p>
            <ProofRow transactionId={settlement.payoutTransactionId} at={settlement.payout.consensusTimestamp} />
          </>
        ) : failed ? (
          <>
            <p className="text-base font-semibold tracking-tight text-destructive">Could not pay out</p>
            <p className="text-[13px]">
              Your verdict was published but failed the format check, which should have been caught before
              signing. Contact us.
            </p>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">What the network said</summary>
              <p className="pt-1">{settlement.failure}</p>
            </details>
            <ProofRow transactionId={settlement.payoutTransactionId} reserved />
          </>
        ) : pending ? (
          <>
            <p className="text-base font-semibold tracking-tight">Published · payment pending</p>
            <p className="text-[13px] text-muted-foreground">
              Your verdict is recorded. Payment lands when the service recovers.
              {settlement.lastReadError !== null ? ` Last read failed: ${settlement.lastReadError}.` : ""}
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={onCheckAgain}>
                Check again
              </Button>
              <span className="text-[11px] text-faint">Nothing is re-signed or re-sent.</span>
            </div>
            <ProofRow transactionId={settlement.payoutTransactionId} reserved />
          </>
        ) : (
          <>
            <p className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <span className="size-2 animate-pulse rounded-full bg-primary" aria-hidden />
              Confirming
            </p>
            <p className="text-[13px] text-muted-foreground">
              {verdictSeen ? "Payment is being released. " : "Waiting for the network to confirm. "}
              Usually about {expected} seconds
              {settlement.slow ? ", taking longer than usual" : ""}.{" "}
              <span className="tabular-nums">{seconds(settlement.elapsedMs)}</span> so far.
              {settlement.lastReadError !== null ? ` Last read failed: ${settlement.lastReadError}. Reading again.` : ""}
            </p>
            <ProofRow transactionId={settlement.payoutTransactionId} reserved />
          </>
        )}

        {platformIssue !== null && (
          <p className="text-xs text-urgent">
            {mode === "mock" ? "The stand-in platform failed" : "The platform reported a problem"}: {platformIssue}.
            Your verdict stands regardless.
          </p>
        )}
      </div>
    </section>
  );
}
