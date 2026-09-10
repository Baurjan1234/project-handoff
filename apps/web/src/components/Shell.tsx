import type { ReactNode } from "react";
import type { ChainMode } from "../chain/config";
import { ModeBanner } from "./ModeBanner";
import { Navbar, type ExpertIdentity } from "./Navbar";
import { TestnetBadge } from "./TestnetBadge";

export type { ExpertIdentity } from "./Navbar";

/**
 * The frame every screen sits in: the mock strip when there is one, the
 * navbar, the page, and the corner badge saying which chain this is.
 */
export function Shell({
  mode,
  identity,
  onDisconnect,
  disconnectHeld = false,
  wide = false,
  openCount = null,
  onInbox,
  children,
}: {
  mode: ChainMode;
  identity: ExpertIdentity;
  onDisconnect?: () => void;
  /** While something is in flight that a disconnect would strand. */
  disconnectHeld?: boolean;
  /** The workspace spans the window, inside a gutter and a cap; the funnel screens sit in a column. */
  wide?: boolean;
  openCount?: number | null;
  onInbox?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-background">
      <ModeBanner mode={mode} />
      <Navbar
        mode={mode}
        identity={identity}
        openCount={openCount}
        onInbox={onInbox}
        onDisconnect={onDisconnect}
        disconnectHeld={disconnectHeld}
      />
      <main
        className={
          wide
            ? "mx-auto w-full max-w-[1600px] lg:px-8"
            : "mx-auto max-w-[860px] px-4 pt-7 pb-24 sm:px-6"
        }
      >
        {children}
      </main>
      <TestnetBadge mode={mode} />
    </div>
  );
}
