import { Check } from "lucide-react";
import type { Verdict } from "@handoff/schema";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export const VERDICT_WORDS: Record<Verdict, string> = {
  approve: "Approve",
  approve_with_changes: "Approve with changes",
  reject: "Reject",
};

const OPTIONS: ReadonlyArray<{ value: Verdict; detail: string }> = [
  { value: "approve", detail: "Stands as delivered." },
  { value: "approve_with_changes", detail: "Acceptable once the listed defects are fixed." },
  { value: "reject", detail: "Not acceptable. The defects say why." },
];

/**
 * Three equal cards, none preselected. A preselected verdict is a
 * recommended verdict by another name, and a recommendation is a bias toward
 * approve, which is the failure mode the product exists to avoid. Equality
 * outranks speed here, deliberately. Reject costs the same click as Approve.
 */
export function VerdictPicker({
  value,
  onChange,
  disabled,
}: {
  value: Verdict | null;
  onChange: (verdict: Verdict) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid gap-3">
      <RadioGroup
        value={value ?? ""}
        onValueChange={(next) => onChange(next as Verdict)}
        disabled={disabled}
        aria-label="Verdict"
        className="grid gap-3"
      >
        {OPTIONS.map((option) => (
          <label
            key={option.value}
            htmlFor={`verdict-${option.value}`}
            className="group relative flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card p-4 transition select-none hover:border-foreground/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[[data-disabled]]:cursor-default has-[[data-state=checked]]:border-foreground has-[[data-state=checked]]:bg-foreground has-[[data-state=checked]]:text-background"
          >
            <RadioGroupItem id={`verdict-${option.value}`} value={option.value} className="sr-only" />
            <span className="grid gap-0.5">
              <span className="text-base leading-tight font-semibold">{VERDICT_WORDS[option.value]}</span>
              <span className="text-xs leading-snug opacity-75">{option.detail}</span>
            </span>
            <span
              className="hidden size-5 shrink-0 items-center justify-center rounded-full bg-background text-foreground group-has-[[data-state=checked]]:flex"
              aria-hidden
            >
              <Check className="size-3.5" strokeWidth={3} />
            </span>
          </label>
        ))}
      </RadioGroup>
      <p className="text-xs text-muted-foreground">A reject is paid. You are delivering a judgment.</p>
    </div>
  );
}
