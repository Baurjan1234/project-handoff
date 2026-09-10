import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link2 } from "lucide-react";
import { parseTinybars, tinybarsToDisplay } from "@handoff/schema";
import { fetchHbarRate, usdWords, type HbarRate } from "../lib/usd";

/** The order value in HBAR, through the schema's money module and nowhere else. */
export function priceWords(priceTinybars: string): string {
  return tinybarsToDisplay(parseTinybars(priceTinybars));
}

type Unit = "usd" | "hbar";

/**
 * The network's rate, fetched once and shared. Only the rate is shared:
 * which unit an amount shows is that amount's own business, so switching one
 * figure never rewrites the rest of the page.
 */
const RateContext = createContext<HbarRate | null>(null);

export function MoneyUnitProvider({ mirrorNodeUrl, children }: { mirrorNodeUrl: string; children: ReactNode }) {
  const [rate, setRate] = useState<HbarRate | null>(null);

  useEffect(() => {
    let live = true;
    fetchHbarRate(mirrorNodeUrl).then(
      (found) => {
        if (live) setRate(found);
      },
      () => {
        // No rate, so no dollars. The amounts stay in HBAR.
      },
    );
    return () => {
      live = false;
    };
  }, [mirrorNodeUrl]);

  return <RateContext.Provider value={rate}>{children}</RateContext.Provider>;
}

export function useHbarRate(): HbarRate | null {
  return useContext(RateContext);
}

/**
 * An amount, in dollars while the network's rate is known, and in HBAR when
 * clicked. Each amount remembers its own unit, so switching the one you are
 * reading leaves every other figure alone.
 *
 * HBAR is the amount. Dollars are Hedera's own fee rate applied to it, and
 * the title says so, because nobody should read the dollar figure as the
 * sum that moved.
 */
export function Amount({ tinybars, className = "" }: { tinybars: string; className?: string }) {
  const rate = useHbarRate();
  const [unit, setUnit] = useState<Unit>("usd");
  const hbar = priceWords(tinybars);
  const dollars = rate === null ? null : usdWords(parseTinybars(tinybars), rate);
  const showing = unit === "usd" && dollars !== null ? dollars : hbar;

  if (dollars === null) {
    return <span className={className}>{hbar}</span>;
  }
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        setUnit((current) => (current === "usd" ? "hbar" : "usd"));
      }}
      title={
        showing === hbar
          ? `${dollars} at Hedera's network rate. Click to switch.`
          : `${hbar} is the amount. Dollars are Hedera's network rate. Click to switch.`
      }
      className={`inline-flex cursor-pointer items-center gap-1 tabular-nums transition ${className}`}
    >
      {showing}
      <Link2 className="size-[11px] shrink-0 opacity-40" aria-hidden />
    </button>
  );
}

/** The escrow treatment: the amount, and that it is locked. */
export function Escrow({
  priceTinybars,
  size = "md",
  align = "right",
}: {
  priceTinybars: string;
  size?: "md" | "lg";
  align?: "left" | "right";
}) {
  return (
    <span className={`grid gap-0.5 ${align === "right" ? "text-right" : ""}`}>
      <Amount
        tinybars={priceTinybars}
        className={`font-mono font-semibold text-paid ${size === "lg" ? "text-2xl" : "text-[15px]"}`}
      />
      <span className="text-[11px] text-faint">locked in escrow</span>
    </span>
  );
}
