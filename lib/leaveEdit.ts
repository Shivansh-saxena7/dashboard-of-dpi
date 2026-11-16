// /admin/leave "Edit end date" (2026-11-16): the 3-parameter admin_edit_leave_end_date
// (supabase/sql/2026-11-16_admin_edit_leave_end_date.sql) changes the end date of any leave, with a reason, and records
// it. Dates are IST calendar days ("YYYY-MM-DD"). "Returned today" means the leave ended yesterday (end_date is
// inclusive everywhere the table is read). Pure: known-answer tested in scripts/check-leave-edit.js.
export const ADMIN_EDIT_LEAVE_END_DATE_RPC = "admin_edit_leave_end_date";
export const RETURNED_TODAY_REASON = "Returned to work today";

export function previousYmd(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export interface LeaveRowLike {
  start_date: string;
  end_date: string | null;
}

// A leave with an end date that is running today can be closed as "returned today" if it started before today.
export function canMarkReturnedToday(row: LeaveRowLike, todayYmd: string): boolean {
  if (!row.end_date) return false; // open-ended: the existing Mark Returned Today button handles it
  const running = row.start_date <= todayYmd && row.end_date >= todayYmd;
  return running && previousYmd(todayYmd) >= row.start_date;
}

// Why a new end date cannot be saved, in plain English, or null when it can.
export function leaveEndDateProblem(row: LeaveRowLike, newEnd: string, reason: string): string | null {
  if (!newEnd) return "Choose an end date.";
  if (newEnd < row.start_date) return "The end date cannot be before the start date.";
  if (row.end_date === newEnd) return "The leave already ends on that date.";
  if (!reason.trim()) return "A reason is required.";
  return null;
}
