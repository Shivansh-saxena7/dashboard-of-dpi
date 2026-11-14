// No-shift alert (2026-11-14): an active field employee who has not started a shift for NO_SHIFT_WORKING_DAYS
// working days and has no leave on record. Their Data never moves on its own (Data waits for calls), so this used to
// go unseen for weeks (one employee since 15 Oct, another since 4 Nov). Run by check-lead-reminders once a day,
// inside the working-day notification window: one System Health warning (source no_shift_alert) and one
// notification to each Admin. No alert for employees on leave, inactive ones, non-field roles / departments, or
// anyone who joined less than NO_SHIFT_WORKING_DAYS working days ago.
// The decision part is pure and known-answer tested in scripts/check-no-shift-alert.js. Shared with Edge Functions,
// so imports carry the .ts extension.

import { isOnLeaveOn, type LeavePeriodRow } from "./ownerLeave.ts";
import { logAnomaly } from "./logAnomaly.ts";

export const NO_SHIFT_WORKING_DAYS = 3;
export const NO_SHIFT_SOURCE = "no_shift_alert";
// Accounts that are not real people (test logins): never alerted. By id, or by exact name (case-insensitive).
export const NO_SHIFT_EXCLUDED_IDS: ReadonlySet<string> = new Set(["d970af89-063d-48b4-98aa-b89260fb3d87"]);
export const NO_SHIFT_EXCLUDED_NAMES: ReadonlySet<string> = new Set(["testing"]);

export function isExcludedFromNoShift(e: { id: string; name: string }): boolean {
  return NO_SHIFT_EXCLUDED_IDS.has(e.id) || NO_SHIFT_EXCLUDED_NAMES.has((e.name || "").trim().toLowerCase());
}

// Only these start shifts (same field-staff rule as Start Shift: no department, or Sales).
export const SHIFT_ROLES: ReadonlySet<string> = new Set(["employee", "team_leader"]);

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_MS = 5.5 * 60 * 60 * 1000;

export interface CalendarLike {
  weeklyOffDay: number | null;
  ranges: { startsAt: number; endsAt: number; kind: string }[];
}

export interface EmployeeLike {
  id: string;
  name: string;
  is_active: boolean;
  role: string | null;
  department: string | null;
  joined: string | null; // YYYY-MM-DD
}

export function istYmd(ms: number): string {
  return new Date(ms + IST_MS).toISOString().slice(0, 10);
}

function ymdStartUtcMs(ymd: string): number {
  return Date.parse(`${ymd}T00:00:00Z`) - IST_MS;
}

export function addDaysYmd(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

// A working day: not the weekly off and not inside a whole-day HOLIDAY (a TIMER_PAUSE is still a working day).
export function isWorkingDayYmd(ymd: string, cal: CalendarLike): boolean {
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  if (cal.weeklyOffDay !== null && dow === cal.weeklyOffDay) return false;
  const start = ymdStartUtcMs(ymd);
  return !cal.ranges.some((r) => r.kind === "HOLIDAY" && r.startsAt <= start && r.endsAt >= start + DAY_MS);
}

// The last n working days before today on which this employee was not on leave (newest first).
export function lastWorkingDaysOffLeave(todayYmd: string, n: number, cal: CalendarLike, leave: LeavePeriodRow[]): string[] {
  const out: string[] = [];
  let d = addDaysYmd(todayYmd, -1);
  for (let i = 0; i < 90 && out.length < n; i++) {
    if (isWorkingDayYmd(d, cal) && !leave.some((r) => isOnLeaveOn(r, d))) out.push(d);
    d = addDaysYmd(d, -1);
  }
  return out;
}

export function isFieldEmployee(e: EmployeeLike): boolean {
  return e.is_active && SHIFT_ROLES.has(e.role || "") && (!e.department || e.department === "sales");
}

// Who to warn about: field employees with no shift on any of their last n working, non-leave days.
export function employeesWithoutShift(args: {
  employees: EmployeeLike[];
  leaveRows: LeavePeriodRow[];
  shiftDays: Map<string, Set<string>>;
  todayYmd: string;
  cal: CalendarLike;
  n?: number;
}): { id: string; name: string; since: string }[] {
  const n = args.n ?? NO_SHIFT_WORKING_DAYS;
  const out: { id: string; name: string; since: string }[] = [];
  for (const e of args.employees) {
    if (!isFieldEmployee(e) || isExcludedFromNoShift(e)) continue;
    const leave = args.leaveRows.filter((r) => r.employee_id === e.id);
    if (leave.some((r) => isOnLeaveOn(r, args.todayYmd))) continue;
    const days = lastWorkingDaysOffLeave(args.todayYmd, n, args.cal, leave);
    if (days.length < n) continue;
    const earliest = days[days.length - 1];
    if (e.joined && e.joined > earliest) continue; // joined inside the window: too new
    const shifts = args.shiftDays.get(e.id) || new Set<string>();
    if (days.some((d) => shifts.has(d))) continue;
    out.push({ id: e.id, name: e.name, since: earliest });
  }
  return out;
}

export function noShiftMessage(list: { name: string; lastShift: string | null }[], n: number = NO_SHIFT_WORKING_DAYS): string {
  const who = list.map((x) => `${x.name.split(" ")[0]} (${x.lastShift ? `last shift ${x.lastShift}` : "no shift on record"})`).join(", ");
  return `${list.length} employee${list.length === 1 ? "" : "s"} without a shift for ${n}+ working days and no leave on record: ${who}. Mark leave or check with them; their Data does not move on its own.`;
}

// --- Job (Edge Function side) ---------------------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
export async function runNoShiftAlertOncePerDay(supabase: any, cal: CalendarLike, nowMs: number = Date.now()): Promise<{ ran: boolean; flagged: number; reason?: string }> {
  const today = istYmd(nowMs);
  const dayStartIso = new Date(ymdStartUtcMs(today)).toISOString();

  const { data: already, error: alreadyError } = await supabase
    .from("system_anomaly_log")
    .select("id")
    .eq("source", NO_SHIFT_SOURCE)
    .gte("last_seen_at", dayStartIso)
    .limit(1);
  if (alreadyError) return { ran: false, flagged: 0, reason: "could not read today's alert" };
  if ((already || []).length > 0) return { ran: false, flagged: 0, reason: "already ran today" };

  const fromYmd = addDaysYmd(today, -45);
  const [empRes, leaveRes, attRes, joinRes] = await Promise.all([
    supabase.from("employees").select("id, name, is_active, role, department, created_at").eq("is_active", true).limit(1000),
    supabase.from("employee_leave_periods").select("employee_id, start_date, end_date").limit(5000),
    supabase.from("attendance").select("employee_id, date").gte("date", fromYmd).not("shift_start_at", "is", null).limit(10000),
    supabase.from("employee_payroll_details").select("employee_id, date_of_joining").limit(1000)
  ]);
  const readError = empRes.error || leaveRes.error || attRes.error || joinRes.error;
  if (readError) return { ran: false, flagged: 0, reason: `read failed: ${readError.message}` };

  const joinedById = new Map<string, string>();
  for (const r of joinRes.data || []) if (r.date_of_joining) joinedById.set(r.employee_id, r.date_of_joining);
  const employees: EmployeeLike[] = (empRes.data || []).map((e: { id: string; name: string; is_active: boolean; role: string | null; department: string | null; created_at: string | null }) => ({
    id: e.id,
    name: e.name || "",
    is_active: e.is_active,
    role: e.role,
    department: e.department,
    joined: joinedById.get(e.id) ?? (e.created_at ? istYmd(Date.parse(e.created_at)) : null)
  }));
  const shiftDays = new Map<string, Set<string>>();
  for (const a of attRes.data || []) {
    if (!shiftDays.has(a.employee_id)) shiftDays.set(a.employee_id, new Set());
    shiftDays.get(a.employee_id)!.add(a.date);
  }

  const flagged = employeesWithoutShift({ employees, leaveRows: leaveRes.data || [], shiftDays, todayYmd: today, cal });
  if (flagged.length === 0) return { ran: true, flagged: 0 };

  const withLast: { id: string; name: string; lastShift: string | null }[] = [];
  for (const f of flagged) {
    const { data: last } = await supabase
      .from("attendance")
      .select("date")
      .eq("employee_id", f.id)
      .not("shift_start_at", "is", null)
      .order("date", { ascending: false })
      .limit(1);
    withLast.push({ id: f.id, name: f.name, lastShift: last && last[0] ? last[0].date : null });
  }
  const message = noShiftMessage(withLast);

  await logAnomaly(supabase, {
    source: NO_SHIFT_SOURCE,
    severity: "warning",
    message,
    context: { day: today, workingDays: NO_SHIFT_WORKING_DAYS, employees: withLast.map((x) => ({ id: x.id, lastShift: x.lastShift })) }
  });

  const { data: admins } = await supabase.from("employees").select("id, name").in("role", ["admin", "super_admin"]).eq("is_active", true).limit(50);
  if (admins && admins.length > 0) {
    await supabase.from("notification").insert(
      admins.map((a: { id: string; name: string | null }) => ({
        employee_id: a.id,
        employee_name: a.name || "",
        title: "Employees not starting shifts",
        message,
        type: "SYSTEM_ANOMALY_WARNING",
        is_read: false
      }))
    );
  }
  return { ran: true, flagged: withLast.length };
}
