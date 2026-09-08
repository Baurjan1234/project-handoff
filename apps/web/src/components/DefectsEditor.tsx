import { X } from "lucide-react";
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
  const code = normalizeDefectCode(draft);
  const budget = defectBudget(defects, draft);
  const duplicate = defects.includes(code);
  const canAdd = !disabled && code.length > 0 && !budget.full && !budget.over && !duplicate;
  const problems = defectProblems(defects);

  function add(): void {
    if (!canAdd) return;
    onChange([...defects, code]);
    onDraftChange("");
  }

  return (
    <div className="grid gap-3">
      {defects.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Defect codes">
          {defects.map((defect, index) => (
            <li
              key={`${defect}-${index}`}
              className="inline-flex items-center gap-1 rounded-full bg-muted py-1 pr-1.5 pl-3 font-mono text-xs"
            >
              {defect}
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remove ${defect}`}
                  className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
                  onClick={() => onChange(defects.filter((_, i) => i !== index))}
                >
                  <X className="size-3" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!disabled ? (
        <div className="flex gap-2">
          <Input
            value={draft}
            placeholder={defects.length === 0 ? "e.g. NO_MONITORING, or leave empty" : "Another code"}
            aria-label="Defect code"
            aria-invalid={budget.over || undefined}
            spellCheck={false}
            autoCapitalize="characters"
            className="h-10 rounded-xl font-mono uppercase"
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
            disabled={budget.full}
          />
          <Button type="button" variant="secondary" className="h-10 rounded-xl" onClick={add} disabled={!canAdd}>
            Add
          </Button>
        </div>
      ) : (
        defects.length === 0 && <span className="text-sm text-muted-foreground">No defects listed.</span>
      )}

      {!disabled && (
        <p className={`text-xs tabular-nums ${budget.over ? "text-destructive" : "text-muted-foreground"}`}>
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
