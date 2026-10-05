import { recycledFromText } from "@/lib/recycleReasonDisplay";

// One merged recycle pill (2026-10-05): "♻ Recycled 1x · from Follow-up ·
// Not Interested" — the lifetime recycle count plus, when the CURRENT
// assignment came from a recycle, where the lead was. Employee / Team
// Leader views get the restricted origin wording (see recycledText);
// Admin / Super Admin / Coordinator pass fullDetail. Truncates instead of
// wrapping so the pill row stays on one line; the title holds the full text.
// Renders nothing for a lead that was never recycled.
export default function RecycledBadge({
  reason,
  fromStage,
  fromStatus,
  count = 0,
  fullDetail = false
}: {
  reason?: string | null;
  fromStage?: string | null;
  fromStatus?: string | null;
  count?: number;
  fullDetail?: boolean;
}) {
  if (!reason && !(count > 0)) return null;

  const from = reason ? recycledFromText(fromStage, fromStatus, fullDetail) : null;
  const text = `Recycled${count > 0 ? ` ${count}x` : ""}${from ? ` · from ${from}` : ""}`;

  return (
    <span
      title={text}
      className="min-w-0 truncate inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-100 whitespace-nowrap"
    >
      ♻ {text}
    </span>
  );
}
