/**
 * The expert's draft, kept in the browser until it is signed. State lives
 * in the order, not the screen: a refresh is never a loss, Back is never
 * destructive, and a claim that expires keeps the notes so the order can be
 * claimed again without retyping.
 *
 * Browser storage only. Nothing here reaches a topic or a server, and
 * nothing here is a key. Storage can be missing (a private window, a
 * blocked origin), so every read and write is wrapped and the app renders
 * correctly with no stored draft.
 */

import type { Verdict } from "@handoff/schema";

export type WorkspaceStep = "notes" | "verdict" | "sign";

export interface Draft {
  readonly notes: string;
  readonly defects: readonly string[];
  readonly verdict: Verdict | null;
  readonly step: WorkspaceStep;
}

export const EMPTY_DRAFT: Draft = { notes: "", defects: [], verdict: null, step: "notes" };

export interface DraftStore {
  load(orderId: string): Draft;
  save(orderId: string, draft: Draft): void;
  clear(orderId: string): void;
}

const VERDICTS: readonly Verdict[] = ["approve", "approve_with_changes", "reject"];
const STEPS: readonly WorkspaceStep[] = ["notes", "verdict", "sign"];

/** Only a shape we wrote is a draft. Anything else is the empty draft. */
export function parseDraft(value: unknown): Draft {
  if (typeof value !== "object" || value === null) return EMPTY_DRAFT;
  const record = value as Record<string, unknown>;
  const notes = typeof record["notes"] === "string" ? record["notes"] : "";
  const defects = Array.isArray(record["defects"])
    ? record["defects"].filter((d): d is string => typeof d === "string")
    : [];
  const verdict = VERDICTS.find((v) => v === record["verdict"]) ?? null;
  const step = STEPS.find((s) => s === record["step"]) ?? "notes";
  return { notes, defects, verdict, step };
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function key(orderId: string): string {
  return `handoff:draft:${orderId}`;
}

export function draftStore(storage: () => StorageLike | undefined): DraftStore {
  return {
    load(orderId) {
      try {
        const raw = storage()?.getItem(key(orderId));
        return raw === null || raw === undefined ? EMPTY_DRAFT : parseDraft(JSON.parse(raw));
      } catch {
        return EMPTY_DRAFT;
      }
    },
    save(orderId, draft) {
      try {
        storage()?.setItem(key(orderId), JSON.stringify(draft));
      } catch {
        // Storage refused. The draft lives in React state until the next save.
      }
    },
    clear(orderId) {
      try {
        storage()?.removeItem(key(orderId));
      } catch {
        // Nothing to clear, or storage refused. Either way there is no draft.
      }
    },
  };
}

export const browserDrafts: DraftStore = draftStore(() =>
  typeof window === "undefined" ? undefined : window.localStorage,
);
