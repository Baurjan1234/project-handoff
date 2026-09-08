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
    <div className="grid gap-2">
      <Textarea
        value={notes}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        rows={6}
        className="min-h-32 rounded-xl text-sm leading-relaxed"
        placeholder="What you checked, what you found, and why the verdict is what it is."
        aria-label="Your notes"
      />
      <p className="text-xs text-muted-foreground">Private. Delivered to the requester; never published.</p>
    </div>
  );
}
