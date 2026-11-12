// Owner on leave (2026-11-12): while an employee has an active employee_leave_periods row, the recycle sweep leaves every
// one of their leads alone (LEAD and DATA): no recycle, no junk, no SLA warning, no pause or visit-lock notice. Pure, no
// DB access; known-answer tested in scripts/check-recycle-deploy.js. Dates are plain IST YYYY-MM-DD.

export interface LeavePeriodRow {
  employee_id: string;
  start_date: string;
  end_date: string | null;
}

export const OWNER_LEAVE_SKIP = "OWNER_ON_LEAVE";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function istDateYmd(nowMs: number = Date.now()): string {
  return new Date(nowMs + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// The end date is the last day of leave; an empty end date means open-ended.
export function isOnLeaveOn(row: LeavePeriodRow, ymd: string): boolean {
  return row.start_date <= ymd && (row.end_date === null || row.end_date >= ymd);
}

export function ownersOnLeave(rows: LeavePeriodRow[] | null | undefined, ymd: string): Set<string> {
  return new Set((rows ?? []).filter((r) => isOnLeaveOn(r, ymd)).map((r) => r.employee_id));
}

// The first thing the sweep asks about a lead. Nothing else about the lead matters while its owner is away.
export function ownerLeaveSkipReason(ownerId: string | null | undefined, onLeave: Set<string>): string | null {
  return ownerId && onLeave.has(ownerId) ? OWNER_LEAVE_SKIP : null;
}

// One guard-event row per owner per sweep run (deduplicated to one a day by the caller), not one per lead.
export function ownerLeaveEvents(skipped: Map<string, string[]>, ymd: string): { leadOwner: string; skipped: number; sampleLeadIds: string[]; date: string }[] {
  return [...skipped.entries()].map(([leadOwner, ids]) => ({ leadOwner, skipped: ids.length, sampleLeadIds: ids.slice(0, 5).map((id) => id.slice(0, 8)), date: ymd }));
}
