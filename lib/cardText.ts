// Text of the old cards (components/LeadCard.tsx / DataCard.tsx, unchanged) for the redesign cards (LeadCardV2 /
// DataCardV2, 2026-11-26). The old card keeps its own copy (it must stay byte-for-byte the same while the flag is
// off); the parity test (tests/e2e/card-parity.spec.ts) renders both on the same data and fails on any difference.
// Pure functions, no imports beyond types and the shared rule helpers' result shapes.
import type { RecycleCutoffReason } from "@/lib/calculateSLAStatus";

export const RECYCLE_REASON_LABEL: Record<RecycleCutoffReason, string> = {
  FOLLOWUP_INACTIVITY: "Follow-up inactivity",
  NOT_CONNECTED_COOLDOWN: "Not Connected cooldown",
  SWITCHED_OFF_COOLDOWN: "Switched Off cooldown",
  NOT_INTERESTED_COOLDOWN: "Not Interested cooldown"
};

export function formatDaysHoursLeft(msRemaining: number): string {
  const totalHours = Math.max(0, Math.floor(msRemaining / (1000 * 60 * 60)));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return days > 0 ? `${days}d ${hours}h left` : `${hours}h left`;
}
export function oldAgo(msAgo: number): string {
  const minutes = Math.max(0, Math.floor(msAgo / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
export function formatCountdown(msRemaining: number): string {
  const totalMinutes = Math.max(0, Math.floor(msRemaining / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m left` : `${minutes}m left`;
}
export const oldAssignedText = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export interface SlaBadge { label: string; pulse?: boolean }
// Same branches, same order, same words as LeadCard.tsx (old) lines 184-224.
export function oldSlaBadge(
  slaStatus: string,
  lead: { sla_deadline: string | null; paused_until?: string | null; pause_reason?: string | null },
  recycleCutoff: { cutoffAt: Date; reason: RecycleCutoffReason } | null,
  now: Date
): SlaBadge | null {
  if (slaStatus === "WITHIN_SLA" && lead.sla_deadline) return { label: formatCountdown(new Date(lead.sla_deadline).getTime() - now.getTime()) };
  if (slaStatus === "SLA_BREACHED") return { label: "Overdue", pulse: true };
  if (slaStatus === "COOLDOWN" && recycleCutoff)
    return { label: `${formatDaysHoursLeft(recycleCutoff.cutoffAt.getTime() - now.getTime())} — ${RECYCLE_REASON_LABEL[recycleCutoff.reason]}` };
  if (slaStatus === "COOLDOWN") return { label: "Cooling down" };
  if ((slaStatus === "RECYCLE_READY" || slaStatus === "JUNK_ELIGIBLE") && recycleCutoff) return { label: `Recycling now — ${RECYCLE_REASON_LABEL[recycleCutoff.reason]}` };
  if (slaStatus === "RECYCLE_READY" || slaStatus === "JUNK_ELIGIBLE") return { label: "Awaiting follow-up" };
  if (slaStatus === "PAUSED" && lead.paused_until) {
    const untilLabel = new Date(lead.paused_until).toLocaleDateString([], { month: "short", day: "numeric" });
    return lead.pause_reason === "VISIT_LOCK"
      ? { label: `🔒 Locked until ${untilLabel}` }
      : lead.pause_reason === "VISIT_PENDING_VERIFICATION"
      ? { label: "⏳ Pending verification" }
      : { label: `😴 Snoozed until ${untilLabel}` };
  }
  if (slaStatus === "FOLLOWUP_INACTIVITY_WARNING" && recycleCutoff)
    return { label: `${formatDaysHoursLeft(recycleCutoff.cutoffAt.getTime() - now.getTime())} — ${RECYCLE_REASON_LABEL[recycleCutoff.reason]}` };
  if (slaStatus === "FOLLOWUP_INACTIVITY_WARNING") return { label: "Needs follow-up" };
  if (slaStatus === "FOLLOWUP_INACTIVITY_RECYCLE_READY" && recycleCutoff) return { label: `Recycling now — ${RECYCLE_REASON_LABEL[recycleCutoff.reason]}`, pulse: true };
  if (slaStatus === "FOLLOWUP_INACTIVITY_RECYCLE_READY") return { label: "Going stale", pulse: true };
  return null;
}

// DataCard (old) lines 134-154: stage pill and calls / attempts pill.
export const oldDataStageText = (boardStage: string | null | undefined) =>
  boardStage && boardStage !== "LEADS" ? (boardStage === "FOLLOW_UP" ? "📞 Follow-up" : boardStage === "VISIT" ? "🏠 Visit" : "✅ Booked") : null;
export function oldDataCallsText(callCount: number, stillAtRisk: boolean, attemptsLeft: number): string | null {
  if (callCount <= 0) return null;
  return stillAtRisk ? `Called ${callCount}x · ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} left` : `Called ${callCount}x`;
}
