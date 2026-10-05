import { recycledText } from "@/lib/recycleReasonDisplay";

// Small "♻ Recycled from <stage/status>" pill for lead cards ("♻ Recycled"
// when the origin isn't known). Renders nothing for a fresh lead, so fresh
// cards stay exactly as they were.
export default function RecycledBadge({
  reason,
  fromStage,
  fromStatus
}: {
  reason?: string | null;
  fromStage?: string | null;
  fromStatus?: string | null;
}) {
  const text = recycledText(reason, fromStage, fromStatus);
  if (!text) return null;

  return (
    <span
      title={`${text} — reassigned to this owner by the recycle sweep`}
      className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-100 whitespace-nowrap"
    >
      ♻ {text}
    </span>
  );
}
