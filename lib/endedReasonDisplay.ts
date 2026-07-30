// Single source of truth for "why did this lead_history row end" —
// used by both the employee-facing SLABreachHistoryCard (only ever
// shows SLA_BREACHED, since employee_sla_breach_history filters to
// that) and the Admin-facing AdminLeadHistoryModal (shows all three,
// since Admin queries lead_history directly with no reason-filter).
// Phrased tense-neutrally (no "you"/employee-name baked in) so the
// same text reads correctly whether it's about the viewer's own
// history or someone else's — each caller adds its own subject
// ("You" vs an employee's name) around this text.
export const ENDED_REASON_TEXT: Record<string, string> = {
  SLA_BREACHED: "No contact within 2 hours of assignment — reassigned to another team member.",
  RECYCLE_READY: "No further contact after the last update — reassigned to another team member.",
  JUNK: "Marked Junk and closed."
};
