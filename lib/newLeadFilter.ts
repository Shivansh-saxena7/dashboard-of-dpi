// "New" in the employee Leads page Status filter (2026-10-30): a lead the current owner has not
// touched in their CURRENT assignment — no Call tap (call_count / first_call_at, both set by
// log_call_click_atomic on the assignment row) and no result saved (outcome_at, set by
// log_lead_update_atomic). Fresh, recycled, reassigned and restored leads all start a new
// assignment row at zero, so the previous owner's calls never count.
//
// It used to be `lead.status === "NEW"`, but a Call tap does not change the status, so a lead
// tapped without saving a result stayed in "New" for good; and a lead reassigned keeping its
// status (e.g. CONNECTED) never showed there although the new owner had not called it yet.

export interface AssignmentTouchFields {
  call_count?: number | null;
  first_call_at?: string | null;
  outcome_at?: string | null;
}

export function isUntouchedInCurrentAssignment(history: AssignmentTouchFields | null | undefined): boolean {
  if (!history) return false;
  return (history.call_count ?? 0) === 0 && !history.first_call_at && !history.outcome_at;
}
