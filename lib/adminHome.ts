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
  // A3: positive-history leads in Junk, once checked (the page's count); null = not checked yet.
  positiveJunk?: number | null;
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
  if (i.positiveJunk && i.positiveJunk > 0) {
    out.push({
      key: "positive-junk",
      severity: "warning",
      title: `${i.positiveJunk} lead${i.positiveJunk === 1 ? "" : "s"} with a positive history ${i.positiveJunk === 1 ? "is" : "are"} in Junk`,
      detail: "can be given back · Positive-history Junk",
      href: "/admin/positive-junk"
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

// ---- A3 (2026-11-19): Lead engine today + positive-history junk. Pure. ----

export interface GuardEventLite {
  source: string;
  action: string;
}
// Plain English for the guard / hold events the sweep and the database write (lead_guard_events).
export const GUARD_LABELS: Record<string, string> = {
  "db_positive_junk_guard/JUNK_REFUSED": "Junk refused (positive history)",
  "db_sibling_guard/RECYCLE_REFUSED": "Recycle refused (number with a positive lead)",
  "recycle_sibling_guard/HOLD:HOLDER_ON_LEAVE": "Sibling hold (holder on leave, shadow)",
  "recycle_sibling_guard/KEEP": "Sibling keep (shadow)",
  "reminder_hold/REMINDER_HOLD": "Reminder hold",
  "restore_hold/RESTORE_HOLD": "Restore hold (protected lead)",
  "owner_leave/OWNER_ON_LEAVE": "Owner on leave (timers paused)",
  "admin_reassign/ADMIN_REASSIGN": "Admin reassign",
  "admin_junk/ADMIN_JUNK": "Admin junk",
  "admin_restore/ADMIN_RESTORE_ONE": "Admin give-back",
  "admin_restore/ADMIN_RESTORE_HELD": "Admin give-back held (sibling)"
};
export const POSITIVE_JUNK_REFUSED = "db_positive_junk_guard/JUNK_REFUSED";

export interface GuardGroup {
  key: string;
  label: string;
  today: number;
  yesterday: number;
}
// Today's events grouped by source/action, with yesterday-at-this-time beside each; most frequent first.
export function groupGuardEvents(today: GuardEventLite[] | null | undefined, yesterday: GuardEventLite[] | null | undefined): GuardGroup[] {
  const map = new Map<string, GuardGroup>();
  const add = (rows: GuardEventLite[] | null | undefined, field: "today" | "yesterday") => {
    for (const r of rows ?? []) {
      const key = `${r.source}/${r.action}`;
      const g = map.get(key) ?? { key, label: GUARD_LABELS[key] ?? key.replace(/_/g, " ").toLowerCase(), today: 0, yesterday: 0 };
      g[field] += 1;
      map.set(key, g);
    }
  };
  add(today, "today");
  add(yesterday, "yesterday");
  return [...map.values()].filter((g) => g.today > 0).sort((a, b) => b.today - a.today || a.key.localeCompare(b.key));
}

// get_admin_guard_event_counts rows: one per (source, action) in the window, already counted in the database.
export interface GuardCountRow {
  source: string;
  action: string;
  n: number | string;
}
// Same groups as groupGuardEvents, from counted rows (no 500-row cap).
export function groupGuardCounts(today: GuardCountRow[] | null | undefined, yesterday: GuardCountRow[] | null | undefined): GuardGroup[] {
  const map = new Map<string, GuardGroup>();
  const add = (rows: GuardCountRow[] | null | undefined, field: "today" | "yesterday") => {
    for (const r of rows ?? []) {
      const key = `${r.source}/${r.action}`;
      const g = map.get(key) ?? { key, label: GUARD_LABELS[key] ?? key.replace(/_/g, " ").toLowerCase(), today: 0, yesterday: 0 };
      g[field] += Number(r.n) || 0;
      map.set(key, g);
    }
  };
  add(today, "today");
  add(yesterday, "yesterday");
  return [...map.values()].filter((g) => g.today > 0).sort((a, b) => b.today - a.today || a.key.localeCompare(b.key));
}
// Admin junk events in a window (source admin_junk, any action), from counted rows.
export function adminJunkCount(rows: GuardCountRow[] | null | undefined): number {
  return (rows ?? []).filter((r) => r.source === "admin_junk").reduce((s, r) => s + (Number(r.n) || 0), 0);
}

export interface RestoreRow {
  protected_until: string;
  restored_at?: string | null;
  undone_at?: string | null;
}
// Open restore protections at a moment: restored by then, not undone by then, protection still running.
export function openProtections(rows: RestoreRow[] | null | undefined, atMs: number): { count: number; earliestEnd: string | null } {
  const open = (rows ?? []).filter(
    (r) =>
      Date.parse(r.protected_until) > atMs &&
      (!r.restored_at || Date.parse(r.restored_at) <= atMs) &&
      (!r.undone_at || Date.parse(r.undone_at) > atMs)
  );
  const earliest = open.map((r) => r.protected_until).sort()[0] ?? null;
  return { count: open.length, earliestEnd: earliest };
}

// The Positive-history Junk page shows data.rows.length as "All": the Home uses the same number from the same RPC.
export function positiveJunkCount(data: { rows?: unknown[] } | null | undefined): number {
  return Array.isArray(data?.rows) ? data!.rows!.length : 0;
}

// ---- A4 (2026-11-20): Visits and bookings + System controls + junk today. Pure. ----

// Start of the IST month that contains nowMs, as an ISO instant.
export function istMonthStartIso(nowMs: number): string {
  const ymd = new Date(nowMs + 5.5 * 3600e3).toISOString().slice(0, 7);
  return new Date(Date.parse(`${ymd}-01T00:00:00+05:30`)).toISOString();
}
// This month so far, and the same month as it stood 24 h ago (empty on the 1st before this time).
export function monthWindows(nowMs: number): { now: { from: string; to: string }; yesterday: { from: string; to: string } } {
  const from = istMonthStartIso(nowMs);
  const y = new Date(nowMs - 86400e3).toISOString();
  return { now: { from, to: new Date(nowMs).toISOString() }, yesterday: { from, to: y < from ? from : y } };
}

// Junk today without a junk timestamp: mark_lead_junk_atomic sends every active admin one LEAD_JUNKED notification per
// junked lead (sweep and admin junk both go through it); admin junk also writes lead_guard_events admin_junk.
// So: all = the viewer's own LEAD_JUNKED notifications, admin = admin_junk events, sweep = the difference.
export function junkToday(notifications: number, adminJunk: number): { sweep: number; admin: number } {
  const n = Math.max(0, notifications || 0);
  const a = Math.max(0, adminJunk || 0);
  return { sweep: Math.max(0, n - a), admin: a };
}

export type ControlState = "ON" | "OFF" | "SHADOW" | "ENFORCE" | "PILOT" | "NOT_SET" | "UNKNOWN";
export const CONTROL_VIEW: Record<ControlState, { icon: string; word: string; severity: Severity | "ok" | "info" | "mute" }> = {
  ON: { icon: "✓", word: "On", severity: "ok" },
  ENFORCE: { icon: "✓", word: "Enforce", severity: "ok" },
  SHADOW: { icon: "◐", word: "Shadow", severity: "info" },
  PILOT: { icon: "◐", word: "Pilot", severity: "info" },
  OFF: { icon: "–", word: "Off", severity: "mute" },
  NOT_SET: { icon: "–", word: "Not set up", severity: "mute" },
  UNKNOWN: { icon: "▲", word: "Unknown", severity: "warning" }
};
export const CONTROLS: { key: string; label: string; kind: "bool" | "mode"; pilotKey?: string }[] = [
  { key: "auto_recycle_enabled", label: "Auto-recycle", kind: "bool" },
  { key: "auto_junk_enabled", label: "Auto-junk", kind: "bool" },
  { key: "positive_junk_guard_mode", label: "Positive-junk guard", kind: "mode" },
  { key: "restore_hold_mode", label: "Restore hold", kind: "mode" },
  { key: "reminder_hold_mode", label: "Reminder hold", kind: "mode" },
  { key: "recycle_sibling_guard_mode", label: "Sibling guard", kind: "mode" },
  { key: "given_lead_context_mode", label: "Given-lead context", kind: "mode", pilotKey: "given_lead_context_pilot_ids" },
  { key: "call_quality_enforced", label: "Call quality enforced", kind: "bool" },
  { key: "employee_home_mode", label: "Employee Home", kind: "mode", pilotKey: "employee_home_pilot_ids" },
  { key: "admin_home_mode", label: "Admin Home", kind: "mode", pilotKey: "admin_home_pilot_ids" }
];
export interface ControlRow {
  key: string;
  label: string;
  state: ControlState;
  pilots: number | null;
}
// One lead_engine_settings row -> what each switch is set to. Missing column = not set up (the flag SQL not applied).
export function controlStates(settings: Record<string, unknown> | null | undefined): ControlRow[] {
  const s = settings ?? {};
  return CONTROLS.map((c) => {
    const has = Object.prototype.hasOwnProperty.call(s, c.key);
    const v = s[c.key];
    let state: ControlState;
    if (!has || v === null || v === undefined) state = "NOT_SET";
    else if (c.kind === "bool") state = v === true ? "ON" : v === false ? "OFF" : "UNKNOWN";
    else {
      const m = String(v).toLowerCase();
      state = m === "on" ? "ON" : m === "off" ? "OFF" : m === "shadow" ? "SHADOW" : m === "enforce" ? "ENFORCE" : m === "pilot" || m === "admin_pilot" ? "PILOT" : "UNKNOWN";
    }
    const p = c.pilotKey ? s[c.pilotKey] : undefined;
    const pilots = Array.isArray(p) ? p.length : null;
    return { key: c.key, label: c.label, state, pilots };
  });
}
