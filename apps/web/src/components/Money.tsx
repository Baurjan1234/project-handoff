import { parseTinybars, tinybarsToDisplay } from "@handoff/schema";

/** The order value, displayed through the schema's money module and nowhere else. */
export function priceWords(priceTinybars: string): string {
  return tinybarsToDisplay(parseTinybars(priceTinybars));
}

/** The escrow treatment: the amount in mono green, and that it is locked. */
export function Escrow({ priceTinybars, size = "md", align = "right" }: { priceTinybars: string; size?: "md" | "lg"; align?: "left" | "right" }) {
  return (
    <span className={`grid gap-0.5 ${align === "right" ? "text-right" : ""}`}>
      <span className={`font-mono font-semibold text-paid tabular-nums ${size === "lg" ? "text-2xl" : "text-[15px]"}`}>
        {priceWords(priceTinybars)}
      </span>
      <span className="text-[11px] text-faint">locked in escrow</span>
    </span>
  );
}
