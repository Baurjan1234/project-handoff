import type { CSSProperties } from "react";

/**
 * A placeholder in the shape of the thing that is coming.
 *
 * Rule 3: nothing spins. A skeleton of the same shape while loading, which
 * only works if it is actually visible — a near-white block on a white card
 * reads as an empty list, not a busy one. The tone and the sweep live in
 * `index.css` as `.skeleton`, so both themes are one place.
 *
 * `delayMs` staggers a group: a list of rows sweeps as one wave rather than
 * blinking in lockstep. It is decoration, never information, so every
 * skeleton is hidden from the reader; the state around it carries the words.
 */
export function Skeleton({ className = "", delayMs = 0 }: { className?: string; delayMs?: number }) {
  const delay = { "--skeleton-delay": `${delayMs}ms` } as CSSProperties;
  return <span className={`skeleton block rounded-sm ${className}`} style={delay} aria-hidden />;
}
