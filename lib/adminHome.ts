// Admin Home A1 (2026-11-19): pure rules for the new Admin Home (admin and super_admin, one Home). No DB access;
// known-answer tested in scripts/check-admin-home.js. Severity follows C:/work/reports/admin_home_design/design.md.
import { isActivityRow } from "./anomalyGroups.ts";

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
