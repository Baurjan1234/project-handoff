import { Copyable } from "./Copyable";
import { HashscanLink } from "./HashscanLink";

/**
 * A transaction id and, for a real one, its Hashscan link. The one
 * component every proof on screen goes through. `reserved` renders the
 * row's height with nothing in it, so that when the proof arrives the layout
 * does not jump: reserve the space before it exists.
 */
export function ProofRow({
  transactionId,
  at,
  reserved = false,
}: {
  transactionId: string | null;
  /** The network's clock, as a consensus timestamp. */
  at?: string | null;
  reserved?: boolean;
}) {
  if (transactionId === null) {
    return reserved ? <div className="min-h-5" aria-hidden /> : null;
  }
  return (
    <div className="flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <Copyable value={transactionId} className="text-xs" />
      <HashscanLink kind="transaction" id={transactionId} />
      {at !== undefined && at !== null && <span className="tabular-nums">at {at}</span>}
    </div>
  );
}
