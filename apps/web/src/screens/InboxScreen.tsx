import type { ReactNode } from "react";
import { CalendarDays, Clock, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Escrow } from "../components/Money";
import { claimWindowWords, clockWords, isPast } from "../lib/clock";
import { askSummary, type InboxEntry } from "../orders/order";

/**
 * "Here is paid work I am qualified for." Only work the expert can take:
 * orders claimed by someone else are hidden with a muted count, and orders
 * past their deadline are gone. A reviewer decides on three facts, what it
 * is, how big it is, how long they have, and the row gives all three before
 * Claim. Claim itself lives on the order, not here.
 *
 * Two lists: what the expert already holds, then what is open.
 */
export function InboxScreen({
  entries,
  now,
  onOpen,
}: {
  /** Null while the first read is in flight. */
  entries: readonly InboxEntry[] | null;
  now: Date;
  onOpen: (orderId: string) => void;
}) {
  if (entries === null) {
    return (
      <div className="grid gap-3" aria-busy>
        <SectionLabel>Open reviews</SectionLabel>
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
          {[0, 1].map((i) => (
            <div key={i} className="h-[76px] animate-pulse border-b border-border bg-secondary last:border-b-0" />
          ))}
        </div>
      </div>
    );
  }

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const live = entries.filter((e) => !isPast(e.order.envelope.deadline, nowSeconds));
  const mine = live.filter((e) => e.claim.kind === "yours");
  const open = live.filter((e) => e.claim.kind === "open");
  const others = live.filter((e) => e.claim.kind === "someone-else").length;

  return (
    <div className="grid gap-7">
      {mine.length > 0 && (
        <section className="grid gap-2.5">
          <SectionLabel>In progress</SectionLabel>
          <List>
            {mine.map((entry) => (
              <Row key={entry.order.envelope.order_id} entry={entry} now={now} onOpen={onOpen} />
            ))}
          </List>
        </section>
      )}

      <section className="grid gap-2.5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <SectionLabel>Open reviews</SectionLabel>
            <p className="mt-1 text-[13px] text-muted-foreground">Reviews matching your credential. Pick one to begin.</p>
          </div>
          {others > 0 && (
            <span className="text-xs text-faint">
              {others} claimed by {others === 1 ? "someone else" : "others"}
            </span>
          )}
        </div>

        {open.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">No work right now.</p>
        ) : (
          <List>
            {open.map((entry) => (
              <Row key={entry.order.envelope.order_id} entry={entry} now={now} onOpen={onOpen} />
            ))}
          </List>
        )}
      </section>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <p className="text-[11px] font-semibold tracking-[0.06em] text-faint uppercase">{children}</p>;
}

function List({ children }: { children: ReactNode }) {
  return <ul className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">{children}</ul>;
}

function Row({ entry, now, onOpen }: { entry: InboxEntry; now: Date; onOpen: (orderId: string) => void }) {
  const { order, claim } = entry;
  const { envelope } = order;
  const yours = claim.kind === "yours";
  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => onOpen(envelope.order_id)}
        className={`flex w-full flex-wrap items-center gap-x-4 gap-y-2.5 border-l-[3px] px-5 py-4 text-left transition-colors hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none ${yours ? "border-l-paid" : "border-l-primary"}`}
      >
        <span className={`size-2 shrink-0 rounded-full ${yours ? "bg-paid" : "bg-primary shadow-[0_0_0_2px_rgba(4,151,254,0.15)]"}`} aria-hidden />

        <span className="grid min-w-0 flex-1 gap-1">
          <span className="truncate font-serif text-[15px] font-semibold text-foreground">{order.title}</span>
          <span className="line-clamp-1 text-xs text-muted-foreground">{askSummary(order.ask)}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1 whitespace-nowrap">
              <CalendarDays className="size-3" aria-hidden />
              Open until <span className="text-foreground">{clockWords(envelope.deadline, now)}</span>
            </span>
            <Dot />
            <span className="flex items-center gap-1 whitespace-nowrap">
              <Clock className="size-3" aria-hidden />
              {claimWindowWords(envelope.claim_timeout_seconds)}
            </span>
            {order.documentWords !== null && (
              <>
                <Dot />
                <span className="flex items-center gap-1 whitespace-nowrap tabular-nums">
                  <FileText className="size-3" aria-hidden />
                  {order.documentWords} words
                </span>
              </>
            )}
            <Dot />
            <Badge variant="outline" className="border-primary/20 bg-primary/5 text-[10px] tracking-[0.04em] text-primary uppercase">
              {envelope.cert_tag}
            </Badge>
          </span>
          {yours && (
            <span className="text-xs font-medium text-paid">
              Claimed · yours to review · sign by {clockWords(claim.signBy, now)}
            </span>
          )}
        </span>

        <span className="flex shrink-0 items-center gap-4">
          <Escrow priceTinybars={envelope.price_tinybars} />
          <Button asChild size="sm" className={`h-8 rounded-lg px-4 text-[13px] font-semibold ${yours ? "bg-paid hover:bg-paid/90" : "hover:bg-azure-hover"}`}>
            <span>{yours ? "Continue" : "Claim"}</span>
          </Button>
        </span>
      </button>
    </li>
  );
}

function Dot() {
  return (
    <span className="text-[10px] text-border" aria-hidden>
      ·
    </span>
  );
}

/** For the tests: the row's one-line ask. */
export const firstLine = askSummary;
