import { Check, PenLine, X } from "lucide-react";
import type { Verdict } from "@handoff/schema";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export const VERDICT_WORDS: Record<Verdict, string> = {
  approve: "Approve",
  approve_with_changes: "Approve with changes",
  reject: "Reject",
};

const OPTIONS: ReadonlyArray<{
  value: Verdict;
  detail: string;
  icon: typeof Check;
  tone: string;
}> = [
  {
    value: "approve",
    detail: "Stands as delivered.",
    icon: Check,
    tone: "[--tone:var(--paid)]",
  },
  {
    value: "approve_with_changes",
    detail: "Acceptable once the listed defects are fixed.",
    icon: PenLine,
    tone: "[--tone:var(--urgent)]",
  },
  {
    value: "reject",
    detail: "Not acceptable. The defects say why.",
    icon: X,
    tone: "[--tone:var(--destructive)]",
  },
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
        className="grid grid-cols-3 gap-2"
      >
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <label
              key={option.value}
              htmlFor={`verdict-${option.value}`}
              className={`group flex cursor-pointer flex-col items-center gap-1.5 rounded-[10px] border-2 border-border bg-card px-2 py-3 text-center transition select-none ${option.tone} hover:border-faint has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[[data-disabled]]:cursor-default has-[[data-state=checked]]:border-[var(--tone)] has-[[data-state=checked]]:bg-[color-mix(in_srgb,var(--tone)_6%,transparent)]`}
              title={option.detail}
            >
              <RadioGroupItem id={`verdict-${option.value}`} value={option.value} className="sr-only" />
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--tone)_15%,transparent)] bg-[color-mix(in_srgb,var(--tone)_8%,transparent)] text-[var(--tone)]"
                aria-hidden
              >
                <Icon className="size-3.5" strokeWidth={2.5} />
              </span>
              <span className="text-[12px] leading-tight font-semibold group-has-[[data-state=checked]]:text-[var(--tone)]">
                {VERDICT_WORDS[option.value]}
              </span>
            </label>
          );
        })}
      </RadioGroup>
      <p className="text-[11px] text-faint">A reject is paid. You are delivering a judgment.</p>
    </div>
  );
}
