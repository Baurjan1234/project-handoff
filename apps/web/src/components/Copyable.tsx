import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * An id or a hash that copies itself on click. The full value goes to the
 * clipboard; `display` is what is shown, for a hash shortened for a glance.
 * Feedback is inline and brief, no toast library.
 */
export function Copyable({ value, display, className }: { value: string; display?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <button
      type="button"
      title="Click to copy"
      className={cn(
        "inline cursor-pointer text-left font-mono text-[0.8125rem] wrap-anywhere text-foreground transition-colors hover:text-primary",
        className,
      )}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          if (timer.current !== null) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1500);
        } catch {
          // No clipboard here. The value is still selectable by hand.
        }
      }}
    >
      {display ?? value}
      {copied && <span className="ml-1.5 text-[11px] font-sans font-semibold text-primary">Copied</span>}
    </button>
  );
}

/** A 64-hex hash shortened for a glance. */
export function shortHash(value: string): string {
  return value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}
