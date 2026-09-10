import { ShieldCheck } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

/**
 * The written review. Private: it goes to the content store and reaches the
 * requester, and only its fingerprint is published. The fingerprint itself
 * lives one click down on the Sign step, not here; here the expert writes.
 */
export function NotesEditor({
  notes,
  onChange,
  disabled,
}: {
  notes: string;
  onChange: (notes: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Textarea
        value={notes}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        rows={6}
        className="min-h-[120px] rounded-[10px] bg-card text-[13px] leading-relaxed"
        placeholder="What did you find? Summarize what you checked and flag anything that needs attention."
        aria-label="Your notes"
      />
      <p className="flex items-center gap-1 text-[11px] text-faint">
        <ShieldCheck className="size-[11px] shrink-0" aria-hidden />
        Private. Delivered to the requester; never published. Only a fingerprint is recorded.
      </p>
    </div>
  );
}
