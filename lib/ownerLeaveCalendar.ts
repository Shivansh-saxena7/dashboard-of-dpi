import { timerCalendar, workingAdd, workingElapsedMs, type NonWorkingRange, type WorkingCalendar } from "./workingCalendar.ts";
import type { LeavePeriodRow } from "./ownerLeave.ts";

// Leave days do not count on a lead's timers (2026-11-12). The owner's own leave is added to the working calendar as
// whole IST days off, so every calendar-based clock (Follow-up inactivity, the result cooldowns) simply pauses for those
// days, and a NEW lead's stored SLA deadline is moved on by the working time the leave took out of it. Uses the CURRENT
// owner only: a clock always starts at the current assignment, so an earlier owner's leave is never inside it.
// Pure, no DB access; known-answer tested in scripts/check-owner-leave-calendar.js.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function istMidnightMs(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - IST_OFFSET_MS;
}

// Each leave as [first day 00:00 IST, day after the last day 00:00 IST). An open-ended leave runs to the end of today:
// the sweep skips the owner's leads while it lasts, and once "Mark Returned Today" sets the end date it is a closed range.
export function leaveRangesFor(rows: LeavePeriodRow[] | null | undefined, ownerId: string | null | undefined, todayYmd: string): NonWorkingRange[] {
  if (!ownerId) return [];
  return (rows ?? [])
    .filter((r) => r.employee_id === ownerId && r.start_date <= todayYmd)
    .map((r) => ({
      id: null,
      startsAt: istMidnightMs(r.start_date),
      endsAt: istMidnightMs(r.end_date && r.end_date < todayYmd ? r.end_date : todayYmd) + DAY_MS,
      reason: "Owner on leave",
      kind: "HOLIDAY" as const
    }));
}

export function ownerCalendar(cal: WorkingCalendar | null, rows: LeavePeriodRow[] | null | undefined, ownerId: string | null | undefined, todayYmd: string): WorkingCalendar | null {
  if (!timerCalendar(cal)) return cal;
  const leave = leaveRangesFor(rows, ownerId, todayYmd);
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
  slaDeadline: string | null | undefined
): string | null {
  if (!slaDeadline) return slaDeadline ?? null;
  const base = timerCalendar(cal);
  const leave = leaveRangesFor(rows, ownerId, todayYmd);
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
