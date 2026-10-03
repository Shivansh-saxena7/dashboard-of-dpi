import type { LeadSibling } from "@/lib/useLeadSiblings";

// "Existing client" line on a lead card — this client (same mobile)
// also has other leads, usually for other projects and possibly with
// other employees. Informational only: each lead is still worked and
// owned independently.
export default function ExistingClientBadge({ siblings }: { siblings?: LeadSibling[] }) {
  if (!siblings || siblings.length === 0) return null;

  const summary = siblings
    .map((s) => `${s.project || "No project"} (${s.is_mine ? "you" : s.owner_name || "Unassigned"})`)
    .join(", ");

  return (
    <p className="text-[11px] text-amber-700 truncate" title={summary}>
      Existing client · also: {summary}
    </p>
  );
}
