import { recycleReasonLabel } from "@/lib/recycleReasonDisplay";

// Small "Recycled · <reason>" pill for lead cards. Renders nothing for a
// fresh lead, so fresh cards stay exactly as they were.
export default function RecycledBadge({ reason }: { reason?: string | null }) {
  const label = recycleReasonLabel(reason);
  if (!label) return null;

  return (
    <span
      title={`Recycled to this owner — ${label}`}
      className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-100 whitespace-nowrap"
    >
      ♻ {label}
    </span>
  );
}
