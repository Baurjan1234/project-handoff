import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { defectProblems } from "../sign/attestation";
import { budgetWords, defectBudget, normalizeDefectCode } from "../sign/defects";

/**
 * Short structured codes, bounded by the schema package. The bounds are
 * imported, never restated, so what this editor lets through is exactly what
 * the verifier lets through. The written reasoning goes in the notes, which
 * stay private.
 *
 * Free text this week, uppercase by convention, normalized rather than
 * rejected. Over budget blocks with an instruction, not a code. The code
 * being typed is owned by the screen, not by this component, so the sign
 * step can refuse while a code sits uncommitted in the box.
 */
export function DefectsEditor({
  defects,
  onChange,
  draft,
  onDraftChange,
  disabled,
}: {
  defects: readonly string[];
  onChange: (defects: readonly string[]) => void;
  draft: string;
  onDraftChange: (draft: string) => void;
  disabled: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const code = normalizeDefectCode(draft);
  const budget = defectBudget(defects, draft);
  const duplicate = defects.includes(code);
  const canAdd = !disabled && code.length > 0 && !budget.full && !budget.over && !duplicate;
  const problems = defectProblems(defects);
  const inputOpen = adding || draft !== "" || defects.length === 0;

  function add(): void {
    if (!canAdd) return;
    onChange([...defects, code]);
    onDraftChange("");
  }

  return (
    <div className="grid gap-2">
      {defects.length > 0 && (
        <ul className="grid gap-1.5" aria-label="Defect codes">
          {defects.map((defect, index) => (
            <li
              key={`${defect}-${index}`}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-[13px]"
            >
              <span className="rounded bg-destructive/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-destructive">{defect}</span>
              <span className="flex-1" />
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remove ${defect}`}
                  className="rounded p-0.5 text-faint transition-colors hover:text-destructive"
                  onClick={() => onChange(defects.filter((_, i) => i !== index))}
                >
                  <X className="size-3" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!disabled && !budget.full && (
        inputOpen ? (
          <div className="flex items-center gap-1.5">
            <Input
              value={draft}
              placeholder={defects.length === 0 ? "e.g. NO_MONITORING, or leave empty" : "Another code"}
              aria-label="Defect code"
              aria-invalid={budget.over || undefined}
              spellCheck={false}
              autoCapitalize="characters"
              autoFocus={adding}
              className="h-9 rounded-lg bg-card font-mono text-xs uppercase"
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
                if (event.key === "Escape") {
                  onDraftChange("");
                  setAdding(false);
                }
              }}
            />
            <Button type="button" variant="outline" size="sm" className="h-9 rounded-lg border-primary text-primary" onClick={add} disabled={!canAdd}>
              Add
            </Button>
            <button
              type="button"
              aria-label="Close"
              className="rounded p-1 text-faint transition-colors hover:text-foreground"
              onClick={() => {
                onDraftChange("");
                setAdding(false);
              }}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs font-medium text-faint transition-colors hover:border-faint hover:text-muted-foreground"
            onClick={() => setAdding(true)}
          >
            <Plus className="size-3" aria-hidden />
            Add defect
          </button>
        )
      )}

      {disabled && defects.length === 0 && <span className="text-sm text-muted-foreground">No defects listed.</span>}

      {!disabled && (
        <p className={`text-right text-[11px] tabular-nums ${budget.over ? "text-destructive" : "text-faint"}`}>
          {budgetWords(budget)}
          {duplicate && code.length > 0 ? " · already listed" : ""}
        </p>
      )}

      {problems.length > 0 && (
        <ul className="text-xs text-destructive">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
