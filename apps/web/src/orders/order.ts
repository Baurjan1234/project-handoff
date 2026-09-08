/**
 * An order as the inbox and the workspace see it: the envelope plus the two
 * things the envelope only commits to by hash. The title and the ask come
 * from the content store, because the envelope carries `spec_hash` and
 * nothing readable. The document itself is not here on purpose: it opens
 * only after a confirmed claim, and a type that carried it would let a
 * screen show it to a non-claimant by accident.
 */

import type { OrderForSigning } from "../sign/sign";

export interface ExpertOrder extends OrderForSigning {
  /** What the work is, one line. */
  readonly title: string;
  /** "What the requester is asking." The task description, from the content store. */
  readonly ask: string;
  /** How big the document is, for the row. Its size is not access-controlled; its text is. */
  readonly documentWords: number;
}

/** What the mirror says about who holds this order. */
export type ClaimState =
  | { readonly kind: "open" }
  | {
      readonly kind: "yours";
      /** The network's clock, not the browser's. */
      readonly claimedAtEpochSeconds: number;
      /** Never past the order deadline. */
      readonly signBy: string;
    }
  | { readonly kind: "someone-else" };

export interface InboxEntry {
  readonly order: ExpertOrder;
  readonly claim: ClaimState;
}

export function countWords(text: string): number {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  return words.length;
}
