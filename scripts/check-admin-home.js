#!/usr/bin/env node
// Admin Home A1 (2026-11-19): known answers for the flag, heartbeat / backup / error severity, the Needs action order,
// and the no-shift input mapping (same as the daily job), plus guards (read-only, bounded, no polling, no new channel,
// the old dashboard unchanged when the flag is off). Run in prebuild. No DB.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];
require.extensions[".ts"] = (m, f) =>
  m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, f);
const ah = require(path.join(root, "lib/adminHome.ts"));
const ns = require(path.join(root, "lib/noShiftAlert.ts"));
const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const has = (src, text) => src.includes(text);

// 1) Flag
const A = "admin-1";
eq("no row = off", ah.adminHomeModeAllows(null, A), false);
eq("column missing = off", ah.adminHomeModeAllows({ auto_junk_enabled: true }, A), false);
eq("unknown value = off", ah.adminHomeModeAllows({ admin_home_mode: "ON" }, A), false);
eq("on", ah.adminHomeModeAllows({ admin_home_mode: "on" }, A), true);
eq("pilot listed", ah.adminHomeModeAllows({ admin_home_mode: "admin_pilot", admin_home_pilot_ids: [A] }, A), true);
eq("pilot not listed", ah.adminHomeModeAllows({ admin_home_mode: "admin_pilot", admin_home_pilot_ids: ["x"] }, A), false);
eq("the employee Home flag does not switch this one", ah.adminHomeModeAllows({ employee_home_mode: "on" }, A), false);

// 2) Heartbeats, backup, errors
const NOW = Date.parse("2026-11-19T10:00:00Z");
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const hb = ah.heartbeatStatus([
  { function_name: "recycle-stale-leads", max_silence_minutes: 30, last_succeeded_at: ago(19) },
  { function_name: "check-lead-reminders", max_silence_minutes: 120, last_succeeded_at: ago(121) },
  { function_name: "db-backup", max_silence_minutes: 1560, last_succeeded_at: ago(600) },
  { function_name: "mark-missed-posts", max_silence_minutes: 1500, last_succeeded_at: null }
], NOW);
eq("heartbeats", hb.map((h) => `${h.name}:${h.severity}`), ["recycle-stale-leads:ok", "check-lead-reminders:critical", "db-backup:ok", "mark-missed-posts:critical"]);
const sweep = (m) => ah.heartbeatStatus([{ function_name: "recycle-stale-leads", max_silence_minutes: 30, last_succeeded_at: ago(m) }], NOW)[0].severity;
eq("sweep 19/20/30/31 min", [sweep(19), sweep(20), sweep(30), sweep(31)], ["ok", "warning", "warning", "critical"]);
eq("backup ok", ah.backupStatus({ run_at: ago(8 * 60), status: "SUCCESS" }, NOW).severity, "ok");
eq("backup failed", ah.backupStatus({ run_at: ago(60), status: "FAILED" }, NOW).severity, "critical");
eq("backup older than 26 h", ah.backupStatus({ run_at: ago(27 * 60), status: "SUCCESS" }, NOW).severity, "critical");
eq("no backup", ah.backupStatus(null, NOW).severity, "critical");
eq("errors today: activity is not a problem (System Health rule)", ah.errorsToday([
  { source: "recycle-stale-leads", severity: "error" },
  { source: "page:/leads", severity: "warning" },
  { source: "db_sibling_guard", severity: "warning" },
  { source: "network:x", severity: "error" },
  { source: "x", severity: "info" }
]), { errors: 1, warnings: 1, info: 3 });

// 3) Needs action: worst first, empty rows hidden, nothing = []
const rows = ah.needsActionRows({
  heartbeats: hb,
  backup: { severity: "ok", at: ago(60), status: "SUCCESS" },
  errors: { errors: 0, warnings: 2 },
  noShift: 2,
  transfers: 1,
  employeeRequests: 0
});
eq("needs action order", rows.map((r) => `${r.key}:${r.severity}`), ["hb:check-lead-reminders:critical", "hb:mark-missed-posts:critical", "errors:warning", "no-shift:warning", "approvals:info"]);
eq("approvals link goes to the right page", rows.find((r) => r.key === "approvals").href, "/admin/lead-transfers");
eq("all clear", ah.needsActionRows({ heartbeats: ah.heartbeatStatus([{ function_name: "recycle-stale-leads", max_silence_minutes: 30, last_succeeded_at: ago(5) }], NOW), backup: { severity: "ok" }, errors: { errors: 0, warnings: 0 }, noShift: 0, transfers: 0, employeeRequests: 0 }), []);
eq("errors red when any error", ah.needsActionRows({ errors: { errors: 1, warnings: 3 } })[0].severity, "critical");
eq("IST header date", ah.istHeaderDate(Date.parse("2026-11-18T19:00:00Z")), "Thursday, 19 Nov");
eq("IST day start", ah.istDayStartIso(Date.parse("2026-11-19T10:00:00Z")), "2026-11-18T18:30:00.000Z");

// 4) No-shift: buildNoShiftInputs = the job's inline mapping (reference copy of lib/noShiftAlert.ts lines in
//    runNoShiftAlertOncePerDay), then the same employeesWithoutShift (3 working days, Tuesday off, "testing" excluded).
const emp = [
  { id: "e1", name: "Ravi", is_active: true, role: "employee", department: "sales", created_at: "2026-10-01T05:00:00Z" },
  { id: "e2", name: "Testing", is_active: true, role: "employee", department: "sales", created_at: "2026-10-01T05:00:00Z" },
  { id: "e3", name: "Asha", is_active: true, role: "employee", department: null, created_at: "2026-11-17T20:00:00Z" },
  { id: "e4", name: "Neha", is_active: true, role: "employee", department: "sales", created_at: "2026-10-01T05:00:00Z" },
  { id: "e5", name: "Admin", is_active: true, role: "admin", department: null, created_at: "2026-10-01T05:00:00Z" }
];
const joins = [{ employee_id: "e4", date_of_joining: "2026-09-01" }];
const att = [{ employee_id: "e4", date: "2026-11-18" }];
const built = ns.buildNoShiftInputs(emp, joins, att);
const refJoined = new Map();
for (const r of joins) if (r.date_of_joining) refJoined.set(r.employee_id, r.date_of_joining);
const refEmployees = emp.map((e) => ({ id: e.id, name: e.name || "", is_active: e.is_active, role: e.role, department: e.department, joined: refJoined.get(e.id) ?? (e.created_at ? ns.istYmd(Date.parse(e.created_at)) : null) }));
eq("no-shift inputs = the job's mapping", built.employees, refEmployees);
eq("shift days", [...built.shiftDays.entries()].map(([k, v]) => [k, [...v]]), [["e4", ["2026-11-18"]]]);
const cal = { weeklyOffDay: 2, ranges: [] };
const flagged = ns.employeesWithoutShift({ employees: built.employees, leaveRows: [], shiftDays: built.shiftDays, todayYmd: "2026-11-19", cal });
eq("no-shift: Ravi only (Testing excluded, Asha too new, Neha worked, Admin not field)", flagged.map((f) => f.id), ["e1"]);

// 5) Guards
const page = read("app/admin/page.tsx");
if (!has(page, "useAdminHomeMode()") || !has(page, "mode.on && mode.employeeId ? <AdminHomeA1 /> : <AdminSocialDashboard />")) problems.push("app/admin/page.tsx: new Home only when the flag is on; otherwise the old dashboard");
const social = read("components/AdminSocialDashboard.tsx");
if (!has(social, "if(!poll) return;") || !has(social, "{ poll = true }")) problems.push("AdminSocialDashboard: old behaviour by default (poll = true); the new Home passes poll={false}");
const ui = read("components/AdminHomeA1.tsx");
if (!has(ui, "<AdminSocialDashboard poll={false} />") || !has(ui, "{socialOpen && (")) problems.push("AdminHomeA1: social dashboard mounted only when opened, without polling");
const hook = read("lib/useAdminHome.ts");
const mode = read("lib/useAdminHomeMode.ts");
for (const [name, src] of [["useAdminHome", hook], ["AdminHomeA1", ui], ["useAdminHomeMode", mode], ["adminHome", read("lib/adminHome.ts")]]) {
  if (/setInterval\(/.test(src)) problems.push(`${name}: no interval polling`);
  if (/\.channel\(/.test(src)) problems.push(`${name}: no new realtime channel`);
  if (/\.(insert|update|upsert|delete)\(/.test(src)) problems.push(`${name}: read-only`);
  if (/\.rpc\(/.test(src)) problems.push(`${name}: no RPC (check_cron_heartbeats writes anomalies)`);
  if (/purple|violet|fuchsia/i.test(src)) problems.push(`${name}: no purple / violet`);
}
const fromCalls = (hook.match(/\.from\("/g) || []).length;
const limits = (hook.match(/\.limit\(/g) || []).length;
if (fromCalls !== limits) problems.push(`useAdminHome: every read bounded (${fromCalls} reads, ${limits} limits)`);
if (!has(mode, "ADMIN_MODE_TIMEOUT_MS = 2000") || !has(mode, "sessionStorage") || !has(mode, 'role === "admin" || role === "super_admin"')) problems.push("useAdminHomeMode: 2 s timeout, remembered per tab, admins only");

if (problems.length) {
  console.error("check-admin-home FAILED:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("check-admin-home: OK");
