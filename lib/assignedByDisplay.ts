// Single source of truth for "who assigned this lead_history row" —
// used by AdminLeadHistoryModal, TeamMemberDetailModal, and
// exportLeadsReport.ts. All three read the same shape off a
// lead_history row (assigned_by_type + the assigned_by employee
// joined via lead_history_assigned_by_employee_id_fkey).
export interface AssignedBySource {
  assigned_by_type: "SYSTEM" | "ADMIN" | "TEAM_LEADER" | "SALES_COORDINATOR" | "SELF";
  assigned_by?: { name: string } | null;
}

export function assignedByLabel(entry: AssignedBySource): string {
  if (entry.assigned_by_type === "TEAM_LEADER") {
    return `Team Leader: ${entry.assigned_by?.name || "Unknown"}`;
  }
  if (entry.assigned_by_type === "ADMIN") {
    return `Admin: ${entry.assigned_by?.name || "Unknown"}`;
  }
  if (entry.assigned_by_type === "SALES_COORDINATOR") {
    return `Sales Coordinator: ${entry.assigned_by?.name || "Unknown"}`;
  }
  // Personal-lead self-add (2026-09-23, create_personal_lead_atomic)
  // — the employee is both the assigner and the assignee here.
  if (entry.assigned_by_type === "SELF") {
    return "Self-added (Personal Lead)";
  }
  return "System (Automatic)";
}
