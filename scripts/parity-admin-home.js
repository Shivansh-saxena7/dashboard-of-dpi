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
const rows = ah.needsActionRows({ heartbeats: hb, backup, errors: errs, noShift: flagged.length, transfers: J.transfers, employeeRequests: J.employee_requests });

console.log(`Jobs: ${hb.map((h) => `${h.label} ${h.severity}`).join(", ")}`);
console.log(`Backup: ${backup.severity} (${backup.status ?? "none"})`);
console.log(`Problems today: Home ${errs.errors} errors / ${errs.warnings} warnings; System Health rule ${J.sh_problems.errors} / ${J.sh_problems.warnings}`);
console.log(`No shift for 3+ working days: Home ${flagged.length}; today's job ${J.job_no_shift && J.job_no_shift.ran ? J.job_no_shift.flagged : "(not run yet today)"}`);
console.log(`Approvals: ${J.transfers} lead transfers, ${J.employee_requests} employee requests`);
console.log(`Needs action: ${rows.length ? rows.map((r) => `${r.key}:${r.severity}`).join(", ") : "All clear"}`);
if (problems.length) {
  console.error("parity-admin-home FAILED:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("parity-admin-home: OK");
