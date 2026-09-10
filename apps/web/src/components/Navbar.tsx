import { ChevronDown, ShieldCheck, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChainMode } from "../chain/config";
import { Copyable } from "./Copyable";
import { HashscanLink } from "./HashscanLink";
import { Logo } from "./Logo";
import { Mono } from "./Mono";

/** Who is signing. On every screen, quietly; on the Sign step, in full. */
export interface ExpertIdentity {
  readonly accountId: string;
  /** Credential tags this expert holds. Plain pills. */
  readonly credentials: readonly string[];
}

/**
 * The navbar every expert screen shares: the mark and wordmark, one tab
 * because there is one place to be, and the expert's identity on the right
 * with the details one click down. No settings, no profile page; the
 * account comes from the connect screen and the dropdown is the whole of it.
 */
export function Navbar({
  mode,
  identity,
  openCount = null,
  onInbox,
  onDisconnect,
  disconnectHeld = false,
}: {
  mode: ChainMode;
  identity: ExpertIdentity;
  /** Orders the expert can take. Null while unknown. */
  openCount?: number | null | undefined;
  onInbox?: (() => void) | undefined;
  onDisconnect?: (() => void) | undefined;
  /** While something is in flight that a disconnect would strand. */
  disconnectHeld?: boolean | undefined;
}) {
  const verified = identity.credentials.length > 0;
  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border bg-card">
      <div className="mx-auto flex h-full max-w-6xl items-center gap-2 px-4 sm:px-6">
        <button type="button" onClick={onInbox} className="mr-6 flex shrink-0 items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Inbox">
          <Logo />
        </button>

        <nav className="flex h-full items-center" aria-label="Primary">
          <button
            type="button"
            onClick={onInbox}
            aria-current="page"
            className="flex h-full items-center gap-1.5 border-b-2 border-primary px-4 text-[13px] font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Inbox
            {openCount !== null && openCount > 0 && (
              <span className="min-w-[18px] rounded-full bg-primary px-1.5 text-center text-[11px] font-semibold text-primary-foreground">{openCount}</span>
            )}
          </button>
        </nav>

        <div className="flex-1" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg px-1.5 py-1 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Your account"
            >
              <span className="flex size-[30px] items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden>
                <User className="size-4" />
              </span>
              <span className="hidden items-center gap-1 text-[13px] font-semibold sm:flex">
                <Mono className="text-[13px]">{identity.accountId}</Mono>
                {verified && <ShieldCheck className="size-3.5 text-primary" aria-label="Certified" />}
              </span>
              <ChevronDown className="size-3 text-faint" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72 p-0">
            <div className="flex items-center gap-2.5 p-4">
              <span className="flex size-[38px] items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden>
                <User className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">Signing as</p>
                <Copyable value={identity.accountId} className="text-xs" />
              </div>
            </div>
            <div className="border-t border-border p-4">
              <p className="mb-2 text-[10px] font-semibold tracking-[0.06em] text-faint uppercase">Credential</p>
              {verified ? (
                <span className="flex flex-wrap gap-1.5">
                  {identity.credentials.map((tag) => (
                    <Badge key={tag} variant="outline" className="border-primary/20 bg-primary/5 text-primary">
                      <ShieldCheck className="size-3" aria-hidden />
                      {tag}
                    </Badge>
                  ))}
                </span>
              ) : (
                <p className="text-xs text-muted-foreground">None on record yet.</p>
              )}
            </div>
            <div className="grid gap-1.5 border-t border-border p-4 text-xs">
              <p className="mb-0.5 text-[10px] font-semibold tracking-[0.06em] text-faint uppercase">Account details</p>
              <p className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Account</span>
                <Mono className="text-xs">{identity.accountId}</Mono>
              </p>
              <p className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Network</span>
                <span className="font-mono text-xs">{mode === "testnet" ? "Hedera testnet" : "Mock chain"}</span>
              </p>
              <HashscanLink kind="account" id={identity.accountId} />
            </div>
            {onDisconnect !== undefined && (
              <div className="border-t border-border p-2">
                <DropdownMenuItem disabled={disconnectHeld} onSelect={onDisconnect} className="text-muted-foreground">
                  Disconnect
                </DropdownMenuItem>
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
