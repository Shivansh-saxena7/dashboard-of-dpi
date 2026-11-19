// Admin Home A1 (2026-11-19): pure rules for the new Admin Home (admin and super_admin, one Home). No DB access;
// known-answer tested in scripts/check-admin-home.js. Severity follows C:/work/reports/admin_home_design/design.md.
import { isActivityRow } from "./anomalyGroups.ts";
import { calculateDailyHrmsStatus } from "./calculateHrmsAttendanceStatus.ts";
import { calculateSLAStatus } from "./calculateSLAStatus.ts";
import { isUntouchedInCurrentAssignment } from "./newLeadFilter.ts";
import { ownersOnLeave, type LeavePeriodRow } from "./ownerLeave.ts";
import { employeesInReturnGrace } from "./ownerLeaveCalendar.ts";
import type { WorkingCalendar } from "./workingCalendar.ts";
import { bandOf, type Band } from "./callQuality.ts";
import { isExcludedFromNoShift, isFieldEmployee, isWorkingDayYmd } from "./noShiftAlert.ts";

export type Severity = "critical" | "warning" | "info" | "ok";
const RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2, ok: 3 };

// lead_engine_settings.admin_home_mode: "off" (default) | "admin_pilot" (only admin_home_pilot_ids) | "on". Read with
// select("*"): before the SQL is applied the column is missing = off; anything unknown = off.
export function adminHomeModeAllows(settings: Record<string, unknown> | null | undefined, employeeId: string | null | undefined): boolean {
  if (!employeeId) return false;
  const mode = settings?.admin_home_mode;
  if (mode === "on") return true;
  if (mode !== "admin_pilot") return false;
  const pilots = settings?.admin_home_pilot_ids;
  return Array.isArray(pilots) && pilots.includes(employeeId);
}

// ---- System: heartbeats, backup, errors ----

export interface HeartbeatRow {
  function_name: string;
  max_silence_minutes: number | null;
  last_succeeded_at: string | null;
}
export interface HeartbeatStatus {
  name: string;
  label: string;
  minutesAgo: number | null;
  severity: Severity;
}

export const HEARTBEAT_LABELS: Record<string, string> = {
  "recycle-stale-leads": "Recycle sweep",
  "check-lead-reminders": "Reminders job",
  "db-backup": "Database backup",
  "backup-to-google-sheets": "Sheets backup",
  "send-meta-capi-events": "Meta events",
  "send-birthday-celebrations": "Birthday messages",
  "mark-missed-posts": "Missed posts job"
};
export const SWEEP = "recycle-stale-leads";
export const SWEEP_AMBER_MIN = 20;
export const SWEEP_RED_MIN = 30;

// Recycle sweep: > 30 min red, 20-30 amber (design.md). Every other job: red once it is silent longer than its own
// max_silence_minutes (the rule check_cron_heartbeats uses), else ok.
export function heartbeatStatus(rows: HeartbeatRow[] | null | undefined, nowMs: number): HeartbeatStatus[] {
  return (rows ?? []).map((r) => {
    const last = r.last_succeeded_at ? Date.parse(r.last_succeeded_at) : NaN;
    const minutesAgo = Number.isFinite(last) ? Math.floor((nowMs - last) / 60000) : null;
    let severity: Severity = "ok";
    if (minutesAgo === null) severity = "critical";
    else if (r.function_name === SWEEP) severity = minutesAgo > SWEEP_RED_MIN ? "critical" : minutesAgo >= SWEEP_AMBER_MIN ? "warning" : "ok";
    else if (r.max_silence_minutes !== null && minutesAgo > r.max_silence_minutes) severity = "critical";
    return { name: r.function_name, label: HEARTBEAT_LABELS[r.function_name] ?? r.function_name, minutesAgo, severity };
  });
}

export interface BackupRow {
  run_at: string;
  status: string;
}
export const BACKUP_MAX_HOURS = 26;
// Latest Sheets backup run: failed, or none in the last 26 h = critical.
export function backupStatus(latest: BackupRow | null | undefined, nowMs: number): { severity: Severity; at: string | null; status: string | null } {
  if (!latest) return { severity: "critical", at: null, status: null };
  const at = Date.parse(latest.run_at);
  const old = !Number.isFinite(at) || nowMs - at > BACKUP_MAX_HOURS * 3600e3;
  return { severity: latest.status !== "SUCCESS" || old ? "critical" : "ok", at: latest.run_at, status: latest.status };
}

export interface AnomalyLite {
  source: string;
  severity: string;
}
// Today's System Health problems: the same "not activity" rule System Health groups by (info and guard activity are
// evidence, not problems). error = critical (red), warning = amber.
export function errorsToday(rows: AnomalyLite[] | null | undefined): { errors: number; warnings: number; info: number } {
  let errors = 0;
  let warnings = 0;
  let info = 0;
  for (const r of rows ?? []) {
    if (isActivityRow(r)) {
      info += 1;
      continue;
    }
    if (r.severity === "error") errors += 1;
    else if (r.severity === "warning") warnings += 1;
    else info += 1;
  }
  return { errors, warnings, info };
}

// ---- Needs action ----

export interface ActionRow {
  key: string;
  severity: Severity;
  title: string;
  detail: string;
  href: string;
}

export function minutesText(m: number | null): string {
  if (m === null) return "never";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.floor(h / 24)} days ago`;
}

export interface NeedsActionInput {
  heartbeats?: HeartbeatStatus[] | null;
  backup?: { severity: Severity; at: string | null; status: string | null } | null;
  errors?: { errors: number; warnings: number } | null;
  noShift?: number | null;
  transfers?: number | null;
  employeeRequests?: number | null;
}

// Worst first; a row with nothing to say is left out. Empty = "All clear".
export function needsActionRows(i: NeedsActionInput): ActionRow[] {
  const out: ActionRow[] = [];
  for (const h of i.heartbeats ?? []) {
    if (h.severity === "ok") continue;
    out.push({
      key: `hb:${h.name}`,
      severity: h.severity,
      title: `${h.label} has not run for ${h.minutesAgo === null ? "a long time" : minutesText(h.minutesAgo).replace(" ago", "")}`,
      detail: h.name === SWEEP ? "expected every 15 min" : "later than expected",
      href: "/admin/system-health"
    });
  }
  if (i.backup && i.backup.severity !== "ok") {
    out.push({
      key: "backup",
      severity: "critical",
      title: i.backup.at ? (i.backup.status !== "SUCCESS" ? "Last backup failed" : "No backup in the last 26 hours") : "No backup on record",
      detail: "Backup status",
      href: "/admin/backup-status"
    });
  }
  if (i.errors && (i.errors.errors > 0 || i.errors.warnings > 0)) {
    const e = i.errors;
    out.push({
      key: "errors",
      severity: e.errors > 0 ? "critical" : "warning",
      title: e.errors > 0 ? `${e.errors} error${e.errors === 1 ? "" : "s"} today` : `${e.warnings} warning${e.warnings === 1 ? "" : "s"} today`,
      detail: e.errors > 0 && e.warnings > 0 ? `and ${e.warnings} warning${e.warnings === 1 ? "" : "s"} · System health` : "System health",
      href: "/admin/system-health"
    });
  }
  if (i.noShift && i.noShift > 0) {
    out.push({
      key: "no-shift",
      severity: "warning",
      title: `${i.noShift} employee${i.noShift === 1 ? " has" : "s have"} not started a shift for 3+ working days`,
      detail: "no leave on record · HR attendance",
      href: "/hr/attendance"
    });
  }
  const approvals = (i.transfers ?? 0) + (i.employeeRequests ?? 0);
  if (approvals > 0) {
    const parts = [
      i.transfers ? `${i.transfers} lead transfer${i.transfers === 1 ? "" : "s"}` : null,
      i.employeeRequests ? `${i.employeeRequests} employee request${i.employeeRequests === 1 ? "" : "s"}` : null
    ].filter(Boolean);
    out.push({
      key: "approvals",
      severity: "info",
      title: `${approvals} approval${approvals === 1 ? "" : "s"} waiting`,
      detail: parts.join(", "),
      href: i.transfers ? "/admin/lead-transfers" : "/admin/employee-requests"
    });
  }
  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

// "Thursday, 19 Nov" in IST.
export function istHeaderDate(nowMs: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).formatToParts(new Date(nowMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")}, ${get("day")} ${get("month")}`;
}
export function istTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
}
// Start of today's IST day, as an ISO string (for "today" reads).
export function istDayStartIso(nowMs: number): string {
  const IST = 5.5 * 3600e3;
  const start = Math.floor((nowMs + IST) / 86400e3) * 86400e3 - IST;
  return new Date(start).toISOString();
}

// ---- A2 (2026-11-19): Today so far + Team today. Pure. ----

// Two windows for "vs yesterday at this time": [today 00:00 IST, now) and [yesterday 00:00 IST, now - 24 h).
export function todayWindows(nowMs: number): { today: { from: string; to: string }; yesterday: { from: string; to: string } } {
  const start = Date.parse(istDayStartIso(nowMs));
  const DAY = 86400e3;
  return {
    today: { from: new Date(start).toISOString(), to: new Date(nowMs).toISOString() },
    yesterday: { from: new Date(start - DAY).toISOString(), to: new Date(nowMs - DAY).toISOString() }
  };
}

export interface Delta {
  text: string;
  dir: "up" | "down" | "same";
}
export function deltaText(today: number, yesterday: number, noun = ""): Delta {
  const d = today - yesterday;
  if (d === 0) return { text: "same as yesterday", dir: "same" };
  return { text: `${d > 0 ? "▲" : "▼"} ${Math.abs(d)} ${d > 0 ? "more" : "fewer"}${noun ? " " + noun : ""}`, dir: d > 0 ? "up" : "down" };
}

export type TeamState = "NOT_STARTED" | "NOT_STARTED_YET" | "LATE" | "ON_SHIFT" | "SHIFT_ENDED" | "ON_LEAVE" | "IN_GRACE" | "DAY_OFF";
export const TEAM_STATE_VIEW: Record<TeamState, { word: string; severity: Severity | "mute"; icon: string }> = {
  NOT_STARTED: { word: "Not started", severity: "warning", icon: "▲" },
  LATE: { word: "Late", severity: "info", icon: "◆" },
  NOT_STARTED_YET: { word: "Not started yet", severity: "mute", icon: "–" },
  IN_GRACE: { word: "In grace", severity: "info", icon: "◆" },
  ON_SHIFT: { word: "On shift", severity: "ok", icon: "✓" },
  SHIFT_ENDED: { word: "Shift ended", severity: "mute", icon: "✓" },
  ON_LEAVE: { word: "On leave", severity: "mute", icon: "–" },
  DAY_OFF: { word: "Day off", severity: "mute", icon: "–" }
};
// Who needs a look first: not started, late, grace, on shift, then the rest.
const STATE_ORDER: TeamState[] = ["NOT_STARTED", "LATE", "IN_GRACE", "NOT_STARTED_YET", "ON_SHIFT", "SHIFT_ENDED", "ON_LEAVE", "DAY_OFF"];

export interface TeamEmployee {
  id: string;
  name: string | null;
  is_active: boolean;
  role: string | null;
  department: string | null;
}
export interface TeamAttendance {
  employee_id: string;
  shift_start_at: string | null;
  shift_end_at: string | null;
  attendance_type: string | null;
}
export interface TeamMember {
  id: string;
  name: string;
  state: TeamState;
  startedAt: string | null;
  inGrace: boolean;
  band: Band | null;
}

// The Start Shift people (lib/noShiftAlert.ts: active, employee / team leader, no department or Sales), test accounts out.
export function teamMembers(employees: TeamEmployee[]): TeamEmployee[] {
  return employees.filter(
    (e) => isFieldEmployee({ ...e, name: e.name || "", joined: null }) && !isExcludedFromNoShift({ id: e.id, name: e.name || "" })
  );
}

// Today's state per person. Started: HR attendance's own rule (calculateDailyHrmsStatus with the on-time cutoffs) =
// On shift or Late; ended = Shift ended. Not started: on leave / day off / in grace / "not started yet" before the first
// start window closes, else Not started.
export function teamStatus(args: {
  employees: TeamEmployee[];
  attendance: TeamAttendance[];
  leaveRows: LeavePeriodRow[];
  cutoffs: { first_half_ontime_cutoff: string; second_half_ontime_cutoff: string };
  firstWindowEnd: string; // lead_engine_settings.first_half_start_window_end, "11:30:00"
  todayYmd: string;
  nowMs: number;
  cal: WorkingCalendar | null;
  bands?: Map<string, Band | null>;
}): TeamMember[] {
  const onLeave = ownersOnLeave(args.leaveRows, args.todayYmd);
  const grace = employeesInReturnGrace(args.leaveRows, args.todayYmd, args.cal);
  const byId = new Map(args.attendance.map((a) => [a.employee_id, a]));
  const working = !args.cal || isWorkingDayYmd(args.todayYmd, { weeklyOffDay: args.cal.weeklyOffDay, ranges: args.cal.ranges });
  const istMin = Math.floor(((args.nowMs + 5.5 * 3600e3) % 86400e3) / 60000);
  const [wh, wm] = args.firstWindowEnd.split(":").map(Number);
  const windowClosed = istMin >= wh * 60 + wm;
  const list = teamMembers(args.employees).map((e) => {
    const a = byId.get(e.id);
    let state: TeamState;
    if (a?.shift_start_at) {
      if (a.shift_end_at) state = "SHIFT_ENDED";
      else {
        const hr = calculateDailyHrmsStatus({ attendance_type: (a.attendance_type as any) ?? null, shift_start_at: a.shift_start_at }, args.cutoffs);
        state = hr === "LATE_COMING" ? "LATE" : "ON_SHIFT";
      }
    } else if (onLeave.has(e.id)) state = "ON_LEAVE";
    else if (!working) state = "DAY_OFF";
    else if (grace.has(e.id)) state = "IN_GRACE";
    else state = windowClosed ? "NOT_STARTED" : "NOT_STARTED_YET";
    return { id: e.id, name: e.name || "", state, startedAt: a?.shift_start_at ?? null, inGrace: grace.has(e.id), band: args.bands?.get(e.id) ?? null };
  });
  const bandRank = (b: Band | null) => (b === "Red" ? 0 : b === "Amber" ? 1 : 2);
  return list.sort((x, y) => STATE_ORDER.indexOf(x.state) - STATE_ORDER.indexOf(y.state) || bandRank(x.band) - bandRank(y.band) || x.name.localeCompare(y.name));
}

export function teamCounts(members: TeamMember[]): Record<"onShift" | "late" | "notStarted" | "onLeave" | "inGrace" | "total", number> {
  const n = (s: TeamState) => members.filter((m) => m.state === s).length;
  return { onShift: n("ON_SHIFT") + n("LATE"), late: n("LATE"), notStarted: n("NOT_STARTED") + n("NOT_STARTED_YET"), onLeave: n("ON_LEAVE"), inGrace: n("IN_GRACE"), total: members.length };
}

// Call Quality per person from the admin summary (get_call_quality_summary with p_employee_id null, 7 days): the Lead
// score when there were Lead dials, else the Data score, else none ("Not enough data") - the employee card's choice.
export function bandsFromSummary(summary: { employees?: { employee_id: string; by_card_type: Record<string, { dial_clicks?: number | null; genuine_score?: number | null } | undefined> }[] } | null | undefined): Map<string, Band | null> {
  const out = new Map<string, Band | null>();
  for (const e of summary?.employees ?? []) {
    const lead = e.by_card_type?.LEAD;
    const data = e.by_card_type?.DATA;
    const showData = (data?.dial_clicks ?? 0) > 0;
    const showLead = (lead?.dial_clicks ?? 0) > 0 || !showData;
    out.set(e.employee_id, bandOf(showLead ? lead?.genuine_score ?? null : data?.genuine_score ?? null));
  }
  return out;
}

// ---- Workload (loaded only when asked) ----
export interface WorkloadLead {
  current_owner_id: string;
  status: string;
  board_stage: string | null;
  sla_deadline: string | null;
  recycle_count: number | null;
  is_personal_lead: boolean | null;
  lead_history: { employee_id: string; is_active: boolean; call_count: number | null; outcome_at: string | null; assigned_at: string | null; first_call_at: string | null; first_whatsapp_at: string | null; last_activity_at: string | null; paused_until: string | null; pause_reason: string | null }[];
}
// Overdue = the lead card's "Needs follow-up" / "Going stale": calculateSLAStatus with exactly LeadCard's inputs
// (LeadList's card fields, not-interested count 0, not on leave, the company calendar).
export function isOverdueOnCard(lead: WorkloadLead, h: WorkloadLead["lead_history"][number], cal: WorkingCalendar | null): boolean {
  const s = calculateSLAStatus(
    {
      status: lead.status,
      sla_deadline: lead.sla_deadline,
      recycle_count: lead.recycle_count,
      board_stage: lead.board_stage,
      paused_until: h.paused_until ?? null,
      last_activity_at: h.last_activity_at ?? null,
      pause_reason: h.pause_reason ?? null,
      assigned_at: h.assigned_at ?? null
    } as any,
    h.outcome_at ?? null,
    0,
    false,
    (lead.is_personal_lead ?? false) as boolean,
    cal
  );
  return s === "FOLLOWUP_INACTIVITY_WARNING" || s === "FOLLOWUP_INACTIVITY_RECYCLE_READY";
}
export function workloadByOwner(leads: WorkloadLead[], cal: WorkingCalendar | null): Map<string, { leads: number; overdue: number; untouched: number }> {
  const out = new Map<string, { leads: number; overdue: number; untouched: number }>();
  for (const l of leads) {
    // The owner's own active assignment (the /leads list of that employee).
    const h = (l.lead_history || []).find((x) => x.is_active && x.employee_id === l.current_owner_id);
    if (!h) continue;
    const w = out.get(l.current_owner_id) ?? { leads: 0, overdue: 0, untouched: 0 };
    w.leads += 1;
    if (isOverdueOnCard(l, h, cal)) w.overdue += 1;
    if (isUntouchedInCurrentAssignment(h)) w.untouched += 1;
    out.set(l.current_owner_id, w);
  }
  return out;
}
