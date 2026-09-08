import { parseTinybars, tinybarsToDisplay } from "@handoff/schema";

/** The order value, displayed through the schema's money module and nowhere else. */
export function priceWords(priceTinybars: string): string {
  return tinybarsToDisplay(parseTinybars(priceTinybars));
}

/** The escrow treatment: the amount, and that it is locked. */
export function Escrow({ priceTinybars, size = "md" }: { priceTinybars: string; size?: "md" | "lg" }) {
  return (
    <span className="grid gap-0.5">
      <span className={`font-semibold tracking-tight tabular-nums ${size === "lg" ? "text-2xl" : "text-base"}`}>
        {priceWords(priceTinybars)}
      </span>
      <span className="text-xs text-muted-foreground">locked in escrow</span>
    </span>
  );
}
