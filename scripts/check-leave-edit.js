#!/usr/bin/env node
// /admin/leave Edit end date (2026-11-16): known answers + guards, run in prebuild. No network.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];
const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
require.extensions[".ts"] = (m, f) =>
  m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, f);
const le = require(path.join(root, "lib/leaveEdit.ts"));

eq("previous day", le.previousYmd("2026-11-16"), "2026-11-15");
eq("previous day across a month", le.previousYmd("2026-12-01"), "2026-11-30");
const tanu = { start_date: "2026-11-12", end_date: "2026-11-15" };
eq("Tanu on 15 Nov: can mark returned (ends 14 Nov)", le.canMarkReturnedToday(tanu, "2026-11-15"), true);
eq("Tanu on 16 Nov: leave already over", le.canMarkReturnedToday(tanu, "2026-11-16"), false);
eq("leave starting today: cannot mark returned", le.canMarkReturnedToday({ start_date: "2026-11-16", end_date: "2026-11-20" }, "2026-11-16"), false);
eq("open-ended: the existing button handles it", le.canMarkReturnedToday({ start_date: "2026-11-01", end_date: null }, "2026-11-16"), false);
eq("future leave", le.canMarkReturnedToday({ start_date: "2026-11-20", end_date: "2026-11-22" }, "2026-11-16"), false);
const raja = { start_date: "2026-11-12", end_date: "2026-11-22" };
eq("no date", le.leaveEndDateProblem(raja, "", "x"), "Choose an end date.");
eq("before start", le.leaveEndDateProblem(raja, "2026-11-10", "x"), "The end date cannot be before the start date.");
eq("same date", le.leaveEndDateProblem(raja, "2026-11-22", "x"), "The leave already ends on that date.");
eq("no reason", le.leaveEndDateProblem(raja, "2026-11-18", "  "), "A reason is required.");
eq("fine", le.leaveEndDateProblem(raja, "2026-11-18", "Returned early"), null);
eq("rpc name", le.ADMIN_EDIT_LEAVE_END_DATE_RPC, "admin_edit_leave_end_date");

const page = read("app/admin/leave/page.tsx");
for (const need of [
  "supabase.rpc(ADMIN_EDIT_LEAVE_END_DATE_RPC, {",
  "p_reason: editReason.trim()",
  "const problem = leaveEndDateProblem(r, editEndDate, editReason);",
  "Edit end date",
  "canMarkReturnedToday(r, istToday)",
  "openEditEndDate(r, previousYmd(istToday), RETURNED_TODAY_REASON)",
  'supabase.rpc("end_employee_leave_atomic", {'
])
  if (!page.includes(need)) problems.push(`app/admin/leave/page.tsx must include ${need}`);

const sqlFile = "supabase/sql/2026-11-16_admin_edit_leave_end_date.sql";
const sql = read(sqlFile);
for (const need of [
  "not coalesce(is_admin(), false)",
  "if v_reason = '' then",
  "if p_end_date < v_row.start_date then",
  "this would overlap another leave of the same employee",
  "insert into lead_guard_events (source, action, lead_id, lead_owner_id, mode, detail)",
  "revoke all on function public.admin_edit_leave_end_date(uuid, date, text) from public, anon;"
])
  if (!sql.includes(need)) problems.push(`${sqlFile} must include ${need}`);
if (/\bdelete\s+from\b|\bdrop\b/i.test(sql.replace(/--.*$/gm, ""))) problems.push(`${sqlFile}: must be additive and never delete a leave`);
if (/perform log_guard_event\(/.test(sql)) problems.push(`${sqlFile}: log_guard_event writes nothing without a lead; insert the audit row directly`);
if (!fs.existsSync(path.join(root, "supabase/sql/2026-11-16_admin_edit_leave_end_date_rollback.sql"))) problems.push("rollback SQL is missing");

if (problems.length) {
  console.error("check-leave-edit: FAILED");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log("check-leave-edit: all known answers and guards pass.");
