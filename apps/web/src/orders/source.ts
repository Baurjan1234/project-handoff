/**
 * Where orders come from. The port the inbox, the order screen and the
 * workspace consume, so that the mock behind it today and `packages/chain`
 * plus `@handoff/content` after the cutover are a one-file swap.
 *
 * Two rules are in the shape. `list` says what the mirror says about each
 * claim and nothing more; the screens never infer "mine" from having
 * clicked. And `document` is a separate call from `list`, taken only after
 * a confirmed claim, so the artifact cannot be shown to a non-claimant by
 * rendering a field that happened to be there.
 */

import type { ConsensusRef } from "@handoff/schema";
import type { ClaimReader } from "./claim";
import type { ExpertOrder, InboxEntry } from "./order";

export interface OrderSource {
  /** Every order the expert is certified for, with the mirror's word on its claim. */
  list(): Promise<readonly InboxEntry[]>;
  /** Submit a claim from the expert's own account. Accepted is not confirmed; see `confirmClaim`. */
  claim(order: ExpertOrder): Promise<ConsensusRef>;
  /** The document under review, from the content store. Only after a confirmed claim. */
  document(order: ExpertOrder): Promise<string>;
  /** Mirror reads of the topic, for confirming a claim. Lagged in mock mode. */
  readonly reader: ClaimReader;
}
