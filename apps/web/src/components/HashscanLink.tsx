import { Link2 } from "lucide-react";
import { hashscanAccountUrl, hashscanTopicUrl, hashscanTransactionUrl } from "../sign/hashscan";

/**
 * Garnish. Renders nothing for a mock id, because mock ids 404 and must never
 * be on camera, and says out loud that Hashscan may lag behind what the app
 * actually reads.
 */
export function HashscanLink({
  kind,
  id,
  label = "View on Hashscan",
}: {
  kind: "transaction" | "account" | "topic";
  id: string;
  label?: string;
}) {
  const href = kind === "transaction" ? hashscanTransactionUrl(id) : kind === "account" ? hashscanAccountUrl(id) : hashscanTopicUrl(id);
  if (href === null) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-[11px] text-faint transition-colors hover:text-primary"
      title="Hashscan is a viewer. It can lag behind what this screen reads."
    >
      <Link2 className="size-[11px]" aria-hidden />
      {label}
    </a>
  );
}
