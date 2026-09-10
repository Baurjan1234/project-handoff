import { useEffect, useState } from "react";
import { ChevronDown, ShieldCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChainMode } from "../chain/config";
import { lookupAccount, type AccountLookup } from "../session/mirrorAccount";
import { Copyable } from "./Copyable";
import { HashscanLink } from "./HashscanLink";
import { Logo } from "./Logo";
import { Amount } from "./Money";
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
 * with the details one click down.
 *
 * The dropdown says only what the network can back. There is no name and no
 * email in this product, because identity is the Hedera account; the balance
 * is a real mirror-node read of that account, taken when the menu first
 * opens rather than at boot, and absent if the read does not answer. No
 * review count, because nothing counts them yet.
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
  const [asked, setAsked] = useState(false);
  const [account, setAccount] = useState<AccountLookup | null>(null);

  // One read, the first time the menu opens. The account id is public and
  // the read needs no key.
  useEffect(() => {
    if (!asked) return;
    const controller = new AbortController();
    void lookupAccount(identity.accountId, { fetch: (...args) => fetch(...args), signal: controller.signal }).then((found) => {
      if (!controller.signal.aborted) setAccount(found);
    });
    return () => controller.abort();
  }, [asked, identity.accountId]);

  const balance = account !== null && account.status === "found" ? account.balanceTinybars : null;

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border bg-card">
      <div className="mx-auto flex h-full max-w-6xl items-center gap-2 px-4 sm:px-6">
        <button
          type="button"
          onClick={onInbox}
          className="mr-6 flex shrink-0 items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Inbox"
        >
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
              <span className="min-w-[18px] rounded-full bg-primary px-1.5 text-center text-[11px] font-semibold text-primary-foreground">
                {openCount}
              </span>
            )}
          </button>
        </nav>

        <div className="flex-1" />

        <DropdownMenu onOpenChange={(open) => open && setAsked(true)}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Your account"
            >
              <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                <Mono className="text-[13px]">{identity.accountId}</Mono>
                {verified && <ShieldCheck className="size-3.5 text-primary" aria-label="Certified" />}
              </span>
              <ChevronDown className="size-3 text-faint" aria-hidden />
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" sideOffset={8} className="w-[280px] overflow-hidden rounded-xl p-0">
            <div className="grid gap-0.5 p-4">
              <p className="text-[10px] font-semibold tracking-[0.06em] text-faint uppercase">Signing as</p>
              <Copyable value={identity.accountId} className="text-sm font-semibold" />
            </div>

            <Section label="Certification">
              {verified ? (
                <span className="flex flex-wrap gap-1.5">
                  {identity.credentials.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-[11px] font-semibold text-primary"
                    >
                      <ShieldCheck className="size-3" aria-hidden />
                      {tag}
                    </span>
                  ))}
                </span>
              ) : (
                <p className="text-xs text-muted-foreground">None on record yet.</p>
              )}
            </Section>

            <Section label="Balance">
              <Row label="Available">
                {balance === null ? (
                  <span className="text-xs text-faint">{account === null ? "…" : "not read"}</span>
                ) : (
                  <Amount tinybars={balance} className="font-mono text-[11.5px] font-semibold text-paid" />
                )}
              </Row>
            </Section>

            <Section label="Account details">
              <Row label="Account">
                <Mono className="text-[11.5px]">{identity.accountId}</Mono>
              </Row>
              <Row label="Network">
                <span className="font-mono text-[11.5px]">{mode === "testnet" ? "Hedera testnet" : "Mock chain"}</span>
              </Row>
              <div className="pt-1">
                <HashscanLink kind="account" id={identity.accountId} label="View on Hashscan" />
              </div>
            </Section>

            {onDisconnect !== undefined && (
              <div className="border-t border-border p-2">
                <DropdownMenuItem disabled={disconnectHeld} onSelect={onDisconnect} className="text-[13px] text-muted-foreground">
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

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 border-t border-border px-4 py-3.5">
      <p className="text-[10px] font-semibold tracking-[0.06em] text-faint uppercase">{label}</p>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </p>
  );
}
