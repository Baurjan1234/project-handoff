import type { ChainMode } from "../chain/config";

/**
 * The fixed corner badge every screen carries: which chain this is. Green
 * for testnet. Amber for the mock, and it says so, because a mock id on a
 * recording is the failure the mode strip and this badge both exist to
 * prevent.
 */
export function TestnetBadge({ mode }: { mode: ChainMode }) {
  const testnet = mode === "testnet";
  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 shadow-xs">
      <span
        className={`size-[7px] rounded-full ${testnet ? "bg-emerald-500 shadow-[0_0_0_2px_rgba(34,197,94,0.19)]" : "bg-urgent shadow-[0_0_0_2px_rgba(217,119,6,0.19)]"}`}
        aria-hidden
      />
      <span className="text-[11px] font-semibold tracking-[0.03em] whitespace-nowrap text-muted-foreground">
        {testnet ? "Hedera testnet" : "Mock chain · never record"}
      </span>
    </div>
  );
}
