import { BOARD_STAGES } from "@/lib/leadBoardStageDisplay";
import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";

// Where a recycled lead came from, for its current owner. Read from the
// ACTIVE lead_history row (employees can only read their own rows):
//   recycle_reason        — set when the assignment came from a recycle
//                           (its presence is what makes a lead "Recycled")
//   recycled_from_stage   — the lead's board stage at the moment it was
//   recycled_from_status    recycled, and its status (2026-10-05; older
//                           recycles backfilled best-effort, else NULL)
// Display/filter/export only: no recycle, assignment or SLA logic reads
// these. One owner for the wording, shared by every lead view + exports.

export type LeadOrigin = "FRESH" | "RECYCLED";

export function leadOrigin(recycleReason: string | null | undefined): LeadOrigin {
  return recycleReason ? "RECYCLED" : "FRESH";
}

// A stage beyond Leads (Follow-up, Visit, Booking) says more about where
// the lead was than its status does; otherwise use the status.
export function recycledFromLabel(stage: string | null | undefined, status: string | null | undefined): string | null {
  if (stage && stage !== "LEADS") {
    return BOARD_STAGES.find((b) => b.stage === stage)?.label || stage;
  }
  if (status) {
    return LEAD_STATUS_DISPLAY[status as keyof typeof LEAD_STATUS_DISPLAY]?.label || status;
  }
  return null;
}

// Who sees the full origin (2026-10-05). Employees and Team Leaders only
// ever see a POSITIVE origin — a later stage (Follow-up, Visit, Booking) or
// an engaged status (Connected, Converted) — otherwise a neutral "Recycled":
// "Recycled from Not Interested / Not Connected" made people skip the call.
// Admin, Super Admin and Coordinator see everything. Display-only.
const POSITIVE_FROM_STATUSES = new Set(["CONNECTED", "CONVERTED"]);

function positiveOnly(stage: string | null | undefined, status: string | null | undefined): { stage: string | null; status: string | null } {
  if (stage && stage !== "LEADS") return { stage, status: null };
  if (status && POSITIVE_FROM_STATUSES.has(status)) return { stage: null, status };
  return { stage: null, status: null };
}

// The "from" part alone — "Follow-up · Not Interested" (full detail: stage
// and status when both are known) or the restricted positive-only label
// ("Follow-up", "Connected"); null when nothing may be shown.
// fullDetail defaults to false so a view that doesn't opt in can never show
// a negative origin.
export function recycledFromText(
  fromStage: string | null | undefined,
  fromStatus: string | null | undefined,
  fullDetail: boolean = false
): string | null {
  if (fullDetail) {
    const stageLabel = fromStage && fromStage !== "LEADS" ? recycledFromLabel(fromStage, null) : null;
    const statusLabel = recycledFromLabel(null, fromStatus);
    return [stageLabel, statusLabel].filter(Boolean).join(" · ") || null;
  }
  const shown = positiveOnly(fromStage, fromStatus);
  return recycledFromLabel(shown.stage, shown.status);
}

// "Recycled from Follow-up" / generic "Recycled"; null for a fresh lead.
export function recycledText(
  recycleReason: string | null | undefined,
  fromStage: string | null | undefined,
  fromStatus: string | null | undefined,
  fullDetail: boolean = false
): string | null {
  if (!recycleReason) return null;
  const from = recycledFromText(fromStage, fromStatus, fullDetail);
  return from ? `Recycled from ${from}` : "Recycled";
}

// Export "Origin / Recycle reason" column — same wording as the badge.
export function originExportText(
  recycleReason: string | null | undefined,
  fromStage?: string | null,
  fromStatus?: string | null,
  fullDetail: boolean = false
): string {
  return recycledText(recycleReason, fromStage, fromStatus, fullDetail) || "Fresh";
}
