// "Positive" lead (2026-10-17) — a lead an employee has made real
// progress on, which the system must never move, junk or recycle away
// from them, or hand a same-number copy of to someone else. Same
// definition as the SQL function positive_number_holders()
// (supabase/sql/2026-10-17_g1_g3_g4_positive_leads.sql) — keep the two
// in step.

export const POSITIVE_STAGES = ["FOLLOW_UP", "VISIT", "BOOKING"] as const;
export const POSITIVE_STATUSES = ["CONNECTED", "CONVERTED"] as const;
export const POSITIVE_PAUSES = ["VISIT_LOCK", "VISIT_PENDING_VERIFICATION"] as const;

export interface PositiveLeadInput {
  status?: string | null;
  board_stage?: string | null;
  pause_reason?: string | null;
}

export function isPositiveLead(lead: PositiveLeadInput): boolean {
  if (lead.status === "JUNK") return false;
  return (
    (POSITIVE_STAGES as readonly string[]).includes(lead.board_stage ?? "") ||
    (POSITIVE_STATUSES as readonly string[]).includes(lead.status ?? "") ||
    (POSITIVE_PAUSES as readonly string[]).includes(lead.pause_reason ?? "")
  );
}

// Text under the admin "Migrate active leads" picker (G4).
export function migrateSummaryText(total: number, positive: number, includePositive: boolean): string {
  if (total === 0) return "No active leads to migrate.";
  const moving = includePositive ? total : total - positive;
  if (positive === 0) return `${moving} active lead(s) will move.`;
  return includePositive
    ? `${moving} active lead(s) will move, including ${positive} in follow-up, visit or connected.`
    : `${moving} active lead(s) will move. ${positive} in follow-up, visit or connected stay with the current employee.`;
}
