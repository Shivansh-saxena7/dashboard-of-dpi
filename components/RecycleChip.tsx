// Recycle countdown chip (2026-10-10): "when does this lead go back to the
// pool". Separate from the header clock (stopwatch, time left to act): this
// one uses a recycle icon and sits in the tags row on every lead card. The
// time comes from the card's own existing calculation (getRecycleCutoff, or a
// new lead's first-call SLA deadline); nothing is recalculated here.
// Presentation only.
import { RefreshCw } from "lucide-react";
import { formatRecycleLeft, recycleChipStyle, TAG } from "@/lib/leadCardLook";

export default function RecycleChip({ at, why, nowMs }: { at: Date | null; why: string; nowMs: number }) {
  if (!at) return null;
  const msLeft = at.getTime() - nowMs;
  if (msLeft <= 0) return null;
  const exact = at.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return (
    <span
      className={`${TAG} tabular-nums`}
      style={recycleChipStyle(msLeft)}
      title={`Goes back to the lead pool around ${exact} — ${why}. The recycle runs during office hours.`}
    >
      <RefreshCw size={11} strokeWidth={2.25} aria-hidden="true" />
      Recycles in {formatRecycleLeft(msLeft)}
    </span>
  );
}
