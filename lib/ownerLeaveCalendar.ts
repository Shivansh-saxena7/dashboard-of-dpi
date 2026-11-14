import { timerCalendar, workingAdd, workingElapsedMs, type NonWorkingRange, type WorkingCalendar } from "./workingCalendar.ts";
import type { LeavePeriodRow } from "./ownerLeave.ts";

// Leave days do not count on a lead's timers (2026-11-12). The owner's own leave is added to the working calendar as
// whole IST days off, so every calendar-based clock (Follow-up inactivity, the result cooldowns) simply pauses for those
// days, and a NEW lead's stored SLA deadline is moved on by the working time the leave took out of it. Uses the CURRENT
// owner only: a clock always starts at the current assignment, so an earlier owner's leave is never inside it.
// Pure, no DB access; known-answer tested in scripts/check-owner-leave-calendar.js.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Return grace (2026-11-14): the first RETURN_GRACE_WORKING_DAYS working days after a leave ends count like leave days
// on the returning owner's own lead timers (so coming back does not mean a pile of leads due at once), and on those
// days the sweep gives them no recycled leads (employeesInReturnGrace). Working day = not the weekly off and not a
// whole-day HOLIDAY; a day that is itself on leave is skipped. Only the owner's own leave; nobody else is affected.
export const RETURN_GRACE_WORKING_DAYS = 2;

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

export function isCompanyWorkingDay(ymd: string, cal: WorkingCalendar | null): boolean {
  if (!cal) return true;
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (cal.weeklyOffDay !== null && dow === cal.weeklyOffDay) return false;
  const start = istMidnightMs(ymd);
  return !cal.ranges.some((r) => r.kind === "HOLIDAY" && r.startsAt <= start && r.endsAt >= start + DAY_MS);
}

function onLeaveOn(rows: LeavePeriodRow[], ownerId: string, ymd: string): boolean {
  return rows.some((r) => r.employee_id === ownerId && r.start_date <= ymd && (r.end_date === null || r.end_date >= ymd));
}

// The grace days of this owner (all leaves that have an end date), oldest first, no duplicates.
export function returnGraceDays(
  rows: LeavePeriodRow[] | null | undefined,
  ownerId: string | null | undefined,
  cal: WorkingCalendar | null,
  n: number = RETURN_GRACE_WORKING_DAYS
): string[] {
  if (!ownerId || n <= 0) return [];
  const mine = (rows ?? []).filter((r) => r.employee_id === ownerId);
  const days = new Set<string>();
  for (const r of mine) {
    if (!r.end_date) continue;
    let d = addDaysYmd(r.end_date, 1);
    let found = 0;
    for (let i = 0; i < 60 && found < n; i++) {
      if (isCompanyWorkingDay(d, cal) && !onLeaveOn(mine, ownerId, d)) {
        days.add(d);
        found += 1;
      }
      d = addDaysYmd(d, 1);
    }
  }
  return [...days].sort();
}

export function employeesInReturnGrace(rows: LeavePeriodRow[] | null | undefined, todayYmd: string, cal: WorkingCalendar | null): Set<string> {
  const out = new Set<string>();
  for (const id of new Set((rows ?? []).map((r) => r.employee_id))) {
    if (onLeaveOn(rows ?? [], id, todayYmd)) continue;
    if (returnGraceDays(rows, id, cal).includes(todayYmd)) out.add(id);
  }
  return out;
}

function istMidnightMs(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - IST_OFFSET_MS;
}

// Each leave as [first day 00:00 IST, day after the last day 00:00 IST). An open-ended leave runs to the end of today:
// the sweep skips the owner's leads while it lasts, and once "Mark Returned Today" sets the end date it is a closed range.
export function leaveRangesFor(
  rows: LeavePeriodRow[] | null | undefined,
  ownerId: string | null | undefined,
  todayYmd: string,
  // Given the company calendar, the return-grace days up to today are added too (RETURN_GRACE_WORKING_DAYS).
  graceCal?: WorkingCalendar | null,
  graceDays: number = RETURN_GRACE_WORKING_DAYS
): NonWorkingRange[] {
  if (!ownerId) return [];
  const leave = (rows ?? [])
    .filter((r) => r.employee_id === ownerId && r.start_date <= todayYmd)
    .map((r) => ({
      id: null,
      startsAt: istMidnightMs(r.start_date),
      endsAt: istMidnightMs(r.end_date && r.end_date < todayYmd ? r.end_date : todayYmd) + DAY_MS,
      reason: "Owner on leave",
      kind: "HOLIDAY" as const
    }));
  if (graceCal === undefined) return leave;
  const grace = returnGraceDays(rows, ownerId, graceCal, graceDays)
    .filter((d) => d <= todayYmd)
    .map((d) => ({ id: null, startsAt: istMidnightMs(d), endsAt: istMidnightMs(d) + DAY_MS, reason: "Back from leave (grace)", kind: "HOLIDAY" as const }));
  return [...leave, ...grace];
}

export function ownerCalendar(
  cal: WorkingCalendar | null,
  rows: LeavePeriodRow[] | null | undefined,
  ownerId: string | null | undefined,
  todayYmd: string,
  graceDays: number = RETURN_GRACE_WORKING_DAYS
): WorkingCalendar | null {
  if (!timerCalendar(cal)) return cal;
  const leave = leaveRangesFor(rows, ownerId, todayYmd, cal, graceDays);
  return leave.length === 0 ? cal : { ...(cal as WorkingCalendar), ranges: [...(cal as WorkingCalendar).ranges, ...leave] };
}

// A NEW lead's sla_deadline is stored at assignment and never re-read from the calendar. Move it on by the working time of
// the owner's leave between the assignment and the (moved) deadline, repeated until it settles, so a leave that runs past
// the first move is counted too. Leave after the deadline, or before the assignment, changes nothing.
export function leaveAdjustedSlaDeadline(
  cal: WorkingCalendar | null,
  rows: LeavePeriodRow[] | null | undefined,
  ownerId: string | null | undefined,
  todayYmd: string,
  assignedAt: string | null | undefined,
  slaDeadline: string | null | undefined,
  graceDays: number = RETURN_GRACE_WORKING_DAYS
): string | null {
  if (!slaDeadline) return slaDeadline ?? null;
  const base = timerCalendar(cal);
  const leave = leaveRangesFor(rows, ownerId, todayYmd, base, graceDays);
  if (!base || leave.length === 0) return slaDeadline;
  const start = assignedAt ? Date.parse(assignedAt) : NaN;
  const original = Date.parse(slaDeadline);
  if (!Number.isFinite(original)) return slaDeadline;
  let effective = original;
  for (let i = 0; i < 20; i++) {
    let taken = 0;
    for (const r of leave) {
      const from = Math.max(r.startsAt, Number.isFinite(start) ? start : r.startsAt);
      const to = Math.min(r.endsAt, effective);
      if (to > from) taken += workingElapsedMs(base, from, to);
    }
    const next = taken > 0 ? workingAdd(base, original, taken).getTime() : original;
    if (next === effective) break;
    effective = next;
  }
  return effective === original ? slaDeadline : new Date(effective).toISOString();
}
