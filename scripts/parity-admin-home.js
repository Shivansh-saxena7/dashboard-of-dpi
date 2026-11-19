#!/usr/bin/env node
// Admin Home A1 live parity (read-only). Input: the output of scripts/admin-home-live.sql. Computes the Home's numbers
// with the same lib functions the Home uses and compares them with System Health's own rule (written in SQL) and the
// daily no-shift job's answer for today. Prints counts only. Exits 1 on a difference.
//   node scripts/parity-admin-home.js --live <export>
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
require.extensions[".ts"] = (m, f) =>
  m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, f);
const ah = require(path.join(root, "lib/adminHome.ts"));
const ns = require(path.join(root, "lib/noShiftAlert.ts"));
const { parseWorkingCalendar } = require(path.join(root, "lib/workingCalendar.ts"));

if (process.argv[2] !== "--live" || !process.argv[3]) {
  console.error("usage: node scripts/parity-admin-home.js --live <export of scripts/admin-home-live.sql>");
  process.exit(2);
}
const raw = fs.readFileSync(process.argv[3], "utf8");
const at = raw.indexOf('"j"');
const from = at >= 0 ? raw.indexOf("{", at) : raw.indexOf("{");
let depth = 0, end = from;
for (; end < raw.length; end++) { if (raw[end] === "{") depth++; if (raw[end] === "}") { depth--; if (!depth) break; } }
const J = JSON.parse(raw.slice(from, end + 1));
const now = Date.parse(J.now);
const problems = [];

const hb = ah.heartbeatStatus(J.heartbeats, now);
const backup = ah.backupStatus(J.backup, now);
const errs = ah.errorsToday(J.anomalies);
if (errs.errors !== J.sh_problems.errors || errs.warnings !== J.sh_problems.warnings) {
  problems.push(`errors today: Home ${errs.errors}/${errs.warnings} vs System Health rule ${J.sh_problems.errors}/${J.sh_problems.warnings}`);
}
const cal = parseWorkingCalendar(J.calendar);
const today = ns.istYmd(now);
const inputs = ns.buildNoShiftInputs(J.employees, J.joins, J.attendance);
const flagged = ns.employeesWithoutShift({ employees: inputs.employees, leaveRows: J.leave, shiftDays: inputs.shiftDays, todayYmd: today, cal });
if (J.job_no_shift && J.job_no_shift.ran && J.job_no_shift.flagged !== flagged.length) {
  problems.push(`no-shift: Home ${flagged.length} vs today's job ${J.job_no_shift.flagged}`);
}
// A2 Team today vs HR attendance's rule (SQL) and the no-shift job.
let teamLine = "Team today: (no A2 data in this export)";
if (J.attendance_today && J.hrms && J.sql_hr) {
  const members = ah.teamStatus({ employees: J.employees, attendance: J.attendance_today, leaveRows: J.leave, cutoffs: J.hrms, firstWindowEnd: J.window_end || "11:30:00", todayYmd: today, nowMs: now, cal });
  const c = ah.teamCounts(members);
  if (c.onShift !== J.sql_hr.started || c.late !== J.sql_hr.late) problems.push(`team: Home on shift ${c.onShift} / late ${c.late} vs HR rule ${J.sql_hr.started} / ${J.sql_hr.late}`);
  const notStarted = members.filter((m) => m.state === "NOT_STARTED").map((m) => m.id.slice(0, 8));
  teamLine = `Team today: ${c.total} field, on shift ${c.onShift} (late ${c.late}), not started ${c.notStarted} [${notStarted.join(", ")}], on leave ${c.onLeave}, in grace ${c.inGrace}; HR rule: started ${J.sql_hr.started}, late ${J.sql_hr.late}`;
}
// A3 Lead engine vs the same numbers counted in SQL.
let engineLine = "Lead engine: (no A3 data in this export)";
if (J.sql_engine) {
  const groups = ah.groupGuardEvents(J.engine_guard_today, J.engine_guard_yesterday);
  const refused = groups.find((g) => g.key === ah.POSITIVE_JUNK_REFUSED);
  const prot = ah.openProtections(J.engine_restore, now);
  const q = J.sql_engine;
  if ((refused?.today ?? 0) !== q.refused_today) problems.push(`junk refused today: Home ${refused?.today ?? 0} vs SQL ${q.refused_today}`);
  if (groups.length !== q.guard_groups_today) problems.push(`guard groups today: Home ${groups.length} vs SQL ${q.guard_groups_today}`);
  if (prot.count !== q.protections_open) problems.push(`open protections: Home ${prot.count} vs SQL ${q.protections_open}`);
  engineLine = `Lead engine: recycled ${q.recycled_today} (yesterday at this time ${q.recycled_yesterday}); junk refused ${refused?.today ?? 0} (SQL ${q.refused_today}); guard groups ${groups.length} (SQL ${q.guard_groups_today}): ${groups.map((g) => `${g.key} ${g.today}`).join(", ")}; open protections ${prot.count} (SQL ${q.protections_open})`;
}
const rows = ah.needsActionRows({ heartbeats: hb, backup, errors: errs, noShift: flagged.length, transfers: J.transfers, employeeRequests: J.employee_requests });

console.log(`Jobs: ${hb.map((h) => `${h.label} ${h.severity}`).join(", ")}`);
console.log(`Backup: ${backup.severity} (${backup.status ?? "none"})`);
console.log(`Problems today: Home ${errs.errors} errors / ${errs.warnings} warnings; System Health rule ${J.sh_problems.errors} / ${J.sh_problems.warnings}`);
console.log(`No shift for 3+ working days: Home ${flagged.length}; today's job ${J.job_no_shift && J.job_no_shift.ran ? J.job_no_shift.flagged : "(not run yet today)"}`);
console.log(teamLine);
console.log(engineLine);
console.log("Positive-history junk: not in this check (get_positive_junk_leads is admin-only and answers the logged-in caller; the Home and the page call it the same way).");
console.log(`Approvals: ${J.transfers} lead transfers, ${J.employee_requests} employee requests`);
console.log(`Needs action: ${rows.length ? rows.map((r) => `${r.key}:${r.severity}`).join(", ") : "All clear"}`);
if (problems.length) {
  console.error("parity-admin-home FAILED:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("parity-admin-home: OK");
