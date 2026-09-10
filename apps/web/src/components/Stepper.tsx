import { Check } from "lucide-react";

export interface StepperStep {
  readonly label: string;
  readonly hint: string;
}

type StepState = "done" | "current" | "todo";

/** The three steps of the column, and where the expert is right now. Compact, one line. */
export function Stepper({ steps, current }: { steps: readonly StepperStep[]; current: number }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label="Progress">
      {steps.map((step, index) => {
        const number = index + 1;
        const state: StepState = number < current ? "done" : number === current ? "current" : "todo";
        return (
          <li key={step.label} className="flex items-center gap-1.5" aria-current={state === "current" ? "step" : undefined}>
            <span
              className={`flex size-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                state === "done"
                  ? "bg-paid text-white"
                  : state === "current"
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-faint"
              }`}
              aria-hidden
            >
              {state === "done" ? <Check className="size-2.5" strokeWidth={3} /> : number}
            </span>
            <span className={`text-xs font-medium ${state === "todo" ? "text-faint" : state === "current" ? "text-foreground" : "text-muted-foreground"}`}>
              {step.label}
            </span>
            {index < steps.length - 1 && <span className="mx-1 h-px w-4 bg-border" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
