import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { defectProblems } from "../sign/attestation";
import { issueBudget, issueCode, issueCodes, issueCountWords, normalizeIssue } from "../sign/defects";

/**
 * The issues, as the expert writes them and as they get published.
 *
 * The expert writes a sentence; the code beside it is the app's, numbered by
 * position, and the code is the only part that goes on-chain. The sentence
 * travels with the notes to the requester, because a code without its
 * sentence is unreadable. Both bounds come from the schema package by way of
 * `sign/defects.ts`, so what this editor accepts is what the verifier
 * accepts.
 *
 * The sentence being typed is owned by the screen, not by this component, so
 * the sign step can refuse while one sits uncommitted in the box.
 */
export function IssuesEditor({
  issues,
  onChange,
  draft,
  onDraftChange,
  disabled,
}: {
  issues: readonly string[];
  onChange: (issues: readonly string[]) => void;
  draft: string;
  onDraftChange: (draft: string) => void;
  disabled: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const text = normalizeIssue(draft);
  const budget = issueBudget(issues, draft);
  const duplicate = issues.some((issue) => normalizeIssue(issue) === text);
  const canAdd = !disabled && text.length > 0 && !budget.full && !duplicate;
  const problems = defectProblems(issueCodes(issues));
  const inputOpen = adding || draft !== "";

  function add(): void {
    if (!canAdd) return;
    onChange([...issues, text]);
    onDraftChange("");
  }

  return (
    <div className="grid gap-1.5">
      {issues.length > 0 && (
        <ul className="grid gap-1.5" aria-label="Issues">
          {issues.map((issue, index) => (
            <li
              key={`${issue}-${index}`}
              className="flex items-start gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-[13px]"
            >
              <span className="mt-px shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-destructive">
                {issueCode(index)}
              </span>
              <span className="min-w-0 flex-1 leading-snug">{issue}</span>
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remove ${issueCode(index)}`}
                  className="mt-px shrink-0 rounded p-0.5 text-faint transition-colors hover:text-destructive"
                  onClick={() => onChange(issues.filter((_, i) => i !== index))}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!disabled &&
        !budget.full &&
        (inputOpen ? (
          <div className="grid gap-1.5">
            <div className="flex items-center gap-1.5">
              <Input
                value={draft}
                placeholder="Describe the issue…"
                aria-label="Issue"
                aria-invalid={budget.over || undefined}
                maxLength={budget.charactersLeft < 0 ? undefined : draft.length + Math.max(budget.charactersLeft, 1)}
                autoFocus={adding}
                className="h-9 rounded-lg bg-card text-[13px]"
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
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 rounded-lg border-primary text-primary"
                onClick={add}
                disabled={!canAdd}
              >
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
            {duplicate && text.length > 0 && <p className="text-[11px] text-faint">Already listed.</p>}
          </div>
        ) : (
          <button
            type="button"
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2.5 text-xs font-medium text-faint transition-colors hover:border-faint hover:text-muted-foreground"
            onClick={() => setAdding(true)}
          >
            <Plus className="size-3" aria-hidden />
            Add issue
          </button>
        ))}

      {disabled && issues.length === 0 && <span className="text-sm text-muted-foreground">No issues listed.</span>}

      {!disabled && (
        <p className="text-right text-[11px] text-faint tabular-nums">
          {issueCountWords(budget)}
          {inputOpen && budget.charactersLeft <= 30 ? ` · ${budget.charactersLeft} characters left` : ""}
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
