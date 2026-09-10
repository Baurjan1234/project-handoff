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
  active = "inbox",
  onInbox,
  onRequests,
  children,
}: {
  mode: ChainMode;
  identity: ExpertIdentity;
  onDisconnect?: () => void;
  /** While something is in flight that a disconnect would strand. */
  disconnectHeld?: boolean;
  /** The workspace spans the window and gutters itself; the funnel screens sit in a column. */
  wide?: boolean;
  openCount?: number | null;
  /** Which tab the current screen belongs to. */
  active?: "inbox" | "requests";
  onInbox?: () => void;
  onRequests?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-background">
      <ModeBanner mode={mode} />
      <Navbar
        mode={mode}
        identity={identity}
        openCount={openCount}
        active={active}
        onInbox={onInbox}
        onRequests={onRequests}
        onDisconnect={onDisconnect}
        disconnectHeld={disconnectHeld}
      />
      <main
        className={wide ? "" : "mx-auto max-w-[860px] px-4 pt-7 pb-24 sm:px-6"}
      >
        {children}
      </main>
      <TestnetBadge mode={mode} />
    </div>
  );
}
