// Why a lead was recycled to its current owner (lead_history.recycle_reason
// on the ACTIVE row — set by recycle_lead_atomic since 2026-10-05, backfilled
// for earlier recycles). Display/filter only: no recycle, assignment or SLA
// logic reads it. One owner for the labels, shared by every lead view and
// the exports.
export type RecycleReason = "SLA_BREACHED" | "RECYCLE_READY" | "FOLLOWUP_INACTIVITY_RECYCLE_READY" | "DATA_MAX_ATTEMPTS_REACHED";

export const RECYCLE_REASON_LABEL: Record<RecycleReason, string> = {
  FOLLOWUP_INACTIVITY_RECYCLE_READY: "Follow-up inactive",
  RECYCLE_READY: "No response",
  SLA_BREACHED: "SLA missed",
  DATA_MAX_ATTEMPTS_REACHED: "Max attempts"
};

export function recycleReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return RECYCLE_REASON_LABEL[reason as RecycleReason] || "Recycled";
}

// "Origin" filter + "Fresh first" sort. A lead is Recycled for its current
// owner when its active assignment came from a recycle.
export type LeadOrigin = "FRESH" | "RECYCLED";

export function leadOrigin(recycleReason: string | null | undefined): LeadOrigin {
  return recycleReason ? "RECYCLED" : "FRESH";
}

// Export column text: "Fresh" or "Recycled — <reason>".
export function originExportText(recycleReason: string | null | undefined): string {
  const label = recycleReasonLabel(recycleReason);
  return label ? `Recycled — ${label}` : "Fresh";
}
