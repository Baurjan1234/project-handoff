import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ChainMode } from "../chain/config";
import { HashscanLink } from "./HashscanLink";
import { ModeBanner } from "./ModeBanner";
import { Mono } from "./Mono";

/** Who is signing. On every screen, quietly; on the Sign step, in full. */
export interface ExpertIdentity {
  readonly accountId: string;
  /** Credential tags this expert holds. Plain pills. */
  readonly credentials: readonly string[];
}

/**
 * The frame every screen sits in: the mode strip, a wordmark, the expert's
 * name and credential pills, and a way out. No nav menu, because there is
 * nowhere else to go.
 */
export function Shell({
  mode,
  identity,
  onDisconnect,
  disconnectHeld = false,
  wide = false,
  children,
}: {
  mode: ChainMode;
  identity: ExpertIdentity;
  onDisconnect?: () => void;
  /** While something is in flight that a disconnect would strand. */
  disconnectHeld?: boolean;
  /** The workspace needs the width; the funnel screens do not. */
  wide?: boolean;
  children: ReactNode;
}) {
  const width = wide ? "max-w-6xl" : "max-w-2xl";
  return (
    <div className="min-h-dvh bg-background">
      <ModeBanner mode={mode} />
      <header className={`mx-auto flex ${width} flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-5 pb-2 sm:px-6`}>
        <h1 className="text-lg font-semibold tracking-tight">
          Handoff <span className="font-normal text-muted-foreground">expert</span>
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Signing as</span>
          <Mono>{identity.accountId}</Mono>
          {identity.credentials.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
          <HashscanLink kind="account" id={identity.accountId} />
          {onDisconnect !== undefined && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={onDisconnect}
              disabled={disconnectHeld}
            >
              Disconnect
            </Button>
          )}
        </div>
      </header>
      <main className={`mx-auto ${width} px-4 pt-4 pb-24 sm:px-6`}>{children}</main>
    </div>
  );
}
