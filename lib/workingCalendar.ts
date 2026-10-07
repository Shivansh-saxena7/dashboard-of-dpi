// Working calendar (2026-10-07) — the TS twin of the DB functions
// working_add / working_elapsed. One calendar for every lead timer: the
// weekly-off day (lead_engine_settings.sla_weekly_off_day, Admin-editable,
// never hardcoded here) plus Admin non-working ranges (non_working_periods:
// holidays / "pause all timers until X"). Time on a non-working day or
// inside a range simply doesn't count, which is also what makes a pause
// "resume from the remaining time" with no extra bookkeeping.
//
// The data always comes from get_working_calendar (one jsonb value, so
// PostgREST's 1000-row cap can't truncate it); this file only does the
// maths. Shared by Next.js and Edge Functions (imported with an explicit
// .ts extension there, like lib/normalizeMobile.ts). The SQL and TS
// versions must agree — scripts/check-working-calendar.js runs the same
// known answers as the DB rollback test in prebuild, and
// scripts/check-working-calendar-parity.mjs compares against the live DB
// functions directly.
//
// Days are IST calendar days. India has no DST, so a fixed +05:30 offset
// is exactly what the DB's 'Asia/Kolkata' gives.

export const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const LOOP_GUARD = 20000;

export type NonWorkingKind = "WEEKLY_OFF" | "HOLIDAY" | "TIMER_PAUSE";

export interface NonWorkingRange {
  id: string | null;
  startsAt: number;
  endsAt: number;
  reason: string;
  kind: "HOLIDAY" | "TIMER_PAUSE";
}

export interface WorkingCalendar {
  // 0 = Sunday ... 6 = Saturday, same as Postgres extract(dow ...).
  weeklyOffDay: number | null;
  ranges: NonWorkingRange[];
  // lead_engine_settings.working_days_timers_enabled — the master switch.
  // OFF = lead timers keep counting plain calendar time.
  timersEnabled: boolean;
}

export type NonWorkingStatus =
  | { isNonWorking: false }
  | { isNonWorking: true; kind: NonWorkingKind; reason: string | null; until: Date };

type TimeInput = Date | string | number;

function toMs(value: TimeInput): number {
  const ms = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`workingCalendar: invalid time ${String(value)}`);
  return ms;
}

function istDayOfWeek(ms: number): number {
  return new Date(ms + IST_OFFSET_MS).getUTCDay();
}

function nextIstMidnight(ms: number): number {
  return Math.floor((ms + IST_OFFSET_MS) / DAY_MS) * DAY_MS + DAY_MS - IST_OFFSET_MS;
}

function isWeeklyOff(cal: WorkingCalendar, ms: number): boolean {
  return cal.weeklyOffDay !== null && istDayOfWeek(ms) === cal.weeklyOffDay;
}

// Latest end among ranges containing ms (overlapping ranges chain), or null.
function containingRangeEnd(cal: WorkingCalendar, ms: number): number | null {
  let end: number | null = null;
  for (const r of cal.ranges) {
    if (r.startsAt <= ms && r.endsAt > ms && (end === null || r.endsAt > end)) end = r.endsAt;
  }
  return end;
}

// Earliest range start strictly after ms and before limit, or null.
function nextRangeStart(cal: WorkingCalendar, ms: number, limit: number): number | null {
  let start: number | null = null;
  for (const r of cal.ranges) {
    if (r.startsAt > ms && r.startsAt < limit && (start === null || r.startsAt < start)) start = r.startsAt;
  }
  return start;
}

// Builds a calendar from get_working_calendar's jsonb.
export function parseWorkingCalendar(raw: any): WorkingCalendar {
  const weeklyOffDay = raw?.weekly_off_day;
  return {
    weeklyOffDay: typeof weeklyOffDay === "number" ? weeklyOffDay : null,
    timersEnabled: raw?.timers_enabled === true,
    ranges: (Array.isArray(raw?.ranges) ? raw.ranges : []).map((r: any) => ({
      id: r.id ?? null,
      startsAt: toMs(r.starts_at),
      endsAt: toMs(r.ends_at),
      reason: r.reason ?? "",
      kind: r.kind
    }))
  };
}

// Fetches the calendar for [from, to). Callers pick a window that covers
// every timer they'll compute — a range outside the window is invisible.
export async function fetchWorkingCalendar(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> },
  from: TimeInput,
  to: TimeInput
): Promise<WorkingCalendar> {
  const { data, error } = await supabase.rpc("get_working_calendar", {
    p_from: new Date(toMs(from)).toISOString(),
    p_to: new Date(toMs(to)).toISOString()
  });
  if (error) throw new Error(`get_working_calendar: ${error.message}`);
  return parseWorkingCalendar(data);
}

// Background jobs (recycle-stale-leads, check-lead-reminders) load the
// calendar through this one function so a failed load is handled the same
// way everywhere (2026-10-07):
// - loaded: use it (its timersEnabled decides calendar vs working time).
// - failed, switch OFF: the job doesn't need it — carry on with null
//   (plain calendar time, the pre-switch behaviour) and report a warning.
// - failed, switch ON (or the switch itself can't be read): the caller
//   must skip its timer work — falling back to calendar time would fire
//   timers earlier than the working-day rule. The caller reports that.
export async function loadJobWorkingCalendar(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> },
  readSwitchOn: () => Promise<boolean>,
  logWarning: (message: string, context: Record<string, unknown>) => Promise<void>,
  now: number = Date.now()
): Promise<{ calendar: WorkingCalendar | null; skipTimerWork: boolean; error: string | null }> {
  try {
    const calendar = await fetchWorkingCalendar(supabase, now - 60 * DAY_MS, now + 400 * DAY_MS);
    return { calendar, skipTimerWork: false, error: null };
  } catch (err) {
    const error = String(err instanceof Error ? err.message : err);
    let switchOn = true;
    try {
      switchOn = await readSwitchOn();
    } catch {
      switchOn = true;
    }
    if (switchOn) return { calendar: null, skipTimerWork: true, error };
    await logWarning("Working calendar failed to load; switch is OFF, so continuing on calendar time", { error });
    return { calendar: null, skipTimerWork: false, error };
  }
}

// The calendar a lead timer should count with: the calendar itself when
// the master switch is ON, null (= plain calendar time, the pre-switch
// behaviour) when it is OFF or no calendar was loaded.
export function timerCalendar(cal: WorkingCalendar | null | undefined): WorkingCalendar | null {
  return cal && cal.timersEnabled ? cal : null;
}

// from + amountMs of WORKING time. Starting inside non-working time waits
// for the next working moment. Mirrors working_add exactly.
export function workingAdd(cal: WorkingCalendar, from: TimeInput, amountMs: number): Date {
  if (amountMs < 0) throw new Error("workingAdd: negative amount");
  let t = toMs(from);
  let left = amountMs;
  for (let guard = 0; left > 0; guard++) {
    if (guard > LOOP_GUARD) throw new Error("workingAdd: calendar loop guard hit");
    const dayEnd = nextIstMidnight(t);
    if (isWeeklyOff(cal, t)) {
      t = dayEnd;
      continue;
    }
    const rangeEnd = containingRangeEnd(cal, t);
    if (rangeEnd !== null) {
      t = rangeEnd;
      continue;
    }
    const segmentEnd = nextRangeStart(cal, t, dayEnd) ?? dayEnd;
    const chunk = Math.min(left, segmentEnd - t);
    t += chunk;
    left -= chunk;
  }
  return new Date(t);
}

// Working milliseconds between from and to (0 if to <= from). Mirrors
// working_elapsed exactly.
export function workingElapsedMs(cal: WorkingCalendar, from: TimeInput, to: TimeInput): number {
  let t = toMs(from);
  const end = toMs(to);
  let total = 0;
  for (let guard = 0; t < end; guard++) {
    if (guard > LOOP_GUARD) throw new Error("workingElapsedMs: calendar loop guard hit");
    const dayEnd = nextIstMidnight(t);
    if (isWeeklyOff(cal, t)) {
      t = Math.min(dayEnd, end);
      continue;
    }
    const rangeEnd = containingRangeEnd(cal, t);
    if (rangeEnd !== null) {
      t = Math.min(rangeEnd, end);
      continue;
    }
    const segmentEnd = Math.min(nextRangeStart(cal, t, dayEnd) ?? dayEnd, end);
    total += segmentEnd - t;
    t = segmentEnd;
  }
  return total;
}

// Is `at` non-working, and if so why and until when (the next working
// moment, following back-to-back weekly-off days and ranges)? For the
// "Timers paused till <date>" banner and for pausing sweeps/notifications.
export function nonWorkingStatusAt(cal: WorkingCalendar, at: TimeInput = Date.now()): NonWorkingStatus {
  const start = toMs(at);
  let kind: NonWorkingKind | null = null;
  let reason: string | null = null;
  let t = start;
  for (let guard = 0; ; guard++) {
    if (guard > LOOP_GUARD) throw new Error("nonWorkingStatusAt: calendar loop guard hit");
    if (isWeeklyOff(cal, t)) {
      if (kind === null) kind = "WEEKLY_OFF";
      t = nextIstMidnight(t);
      continue;
    }
    const range = cal.ranges
      .filter((r) => r.startsAt <= t && r.endsAt > t)
      .sort((a, b) => b.endsAt - a.endsAt)[0];
    if (range) {
      if (kind === null) {
        kind = range.kind;
        reason = range.reason;
      }
      t = range.endsAt;
      continue;
    }
    break;
  }
  return kind === null ? { isNonWorking: false } : { isNonWorking: true, kind, reason, until: new Date(t) };
}
