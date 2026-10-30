// "New" in the employee Leads page Status filter (2026-10-30): a lead the current owner has done
// NOTHING with in their CURRENT assignment — no Call tap (call_count / first_call_at, set by
// log_call_click_atomic), no WhatsApp tap (first_whatsapp_at), no result saved (outcome_at, set by
// log_lead_update_atomic), and no note, reminder or stage move either. Those last ones set no
// field of their own on the assignment row, but every employee action bumps last_activity_at,
// which starts equal to assigned_at on a new row (fresh, recycled, reassigned or restored), so the
// previous owner's work never counts.
//
// It used to be `lead.status === "NEW"`, but a Call tap, a note or a Follow-up move does not change
// the status, so such a lead stayed in "New" for good; and a lead reassigned keeping its status
// (e.g. CONNECTED) never showed there although the new owner had not touched it yet.

export interface AssignmentTouchFields {
  call_count?: number | null;
  first_call_at?: string | null;
  first_whatsapp_at?: string | null;
  outcome_at?: string | null;
  assigned_at?: string | null;
  last_activity_at?: string | null;
}

// last_activity_at and assigned_at are written in the same statement on a new row; allow for
// clock rounding between the two.
const SAME_MOMENT_MS = 2000;

export function isUntouchedInCurrentAssignment(history: AssignmentTouchFields | null | undefined): boolean {
  if (!history) return false;
  if ((history.call_count ?? 0) !== 0 || history.first_call_at || history.first_whatsapp_at || history.outcome_at) return false;
  if (!history.last_activity_at || !history.assigned_at) return true;
  const last = Date.parse(history.last_activity_at);
  const assigned = Date.parse(history.assigned_at);
  if (!Number.isFinite(last) || !Number.isFinite(assigned)) return true;
  return last <= assigned + SAME_MOMENT_MS;
}
