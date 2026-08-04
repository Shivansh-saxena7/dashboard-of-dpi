// Single source of truth for "why did this lead_history row end" —
// used by both the employee-facing SLABreachHistoryCard (via the
// employee_sla_breach_history view, generalized as of the History
// tab rename to include every ended_reason, not just SLA_BREACHED)
// and the Admin-facing AdminLeadHistoryModal (shows all four, since
// Admin queries lead_history directly with no reason-filter).
// Phrased tense-neutrally (no "you"/employee-name baked in) so the
// same text reads correctly whether it's about the viewer's own
// history or someone else's — each caller adds its own subject
// ("You" vs an employee's name) around this text.
export const ENDED_REASON_TEXT: Record<string, string> = {
  SLA_BREACHED: "No contact within 2 hours of assignment — reassigned to another team member.",
  RECYCLE_READY: "No further contact after the last update — reassigned to another team member.",
  JUNK: "Marked Junk and closed.",
  TEAM_LEADER_REASSIGNED: "Manually reassigned to another team member by the Team Leader."
};

export interface EndedReasonBadge {
  label: string;
  icon: string;
  className: string;
}

// Companion to ENDED_REASON_TEXT — visual treatment per reason for
// SLABreachHistoryCard's badge/icon, now that the History tab shows
// more than just SLA breaches. Falls back to a neutral slate badge
// for any reason not listed here (defensive only — every value the
// backend actually writes to ended_reason has an entry above).
export const ENDED_REASON_BADGE: Record<string, EndedReasonBadge> = {
  SLA_BREACHED: { label: "SLA Breach", icon: "⚠️", className: "bg-red-100 text-red-700" },
  RECYCLE_READY: { label: "Recycled", icon: "⚠️", className: "bg-red-100 text-red-700" },
  JUNK: { label: "Marked Junk", icon: "🗑️", className: "bg-slate-200 text-slate-600" },
  TEAM_LEADER_REASSIGNED: { label: "Reassigned", icon: "🔄", className: "bg-amber-100 text-amber-700" }
};

export const DEFAULT_ENDED_REASON_BADGE: EndedReasonBadge = {
  label: "History",
  icon: "📋",
  className: "bg-slate-200 text-slate-600"
};
