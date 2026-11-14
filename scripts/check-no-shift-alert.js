#!/usr/bin/env node
// No-shift alert (2026-11-14): known answers + guards, run in prebuild. No DB: the job runs against a fake client.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];
require.extensions[".ts"] = (m, f) =>
  m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, f);
const na = require(path.join(root, "lib/noShiftAlert.ts"));
const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const IST = (ymd) => Date.parse(`${ymd}T00:00:00+05:30`);
const diwali = { startsAt: IST("2026-11-07"), endsAt: IST("2026-11-11"), kind: "HOLIDAY" };
const pause = { startsAt: IST("2026-11-12"), endsAt: IST("2026-11-13"), kind: "TIMER_PAUSE" };
const cal = { weeklyOffDay: 2, ranges: [diwali, pause] };

eq("N is 3", na.NO_SHIFT_WORKING_DAYS, 3);
eq("Tuesday off", na.isWorkingDayYmd("2026-11-17", cal), false);
eq("Diwali holiday", na.isWorkingDayYmd("2026-11-09", cal), false);
eq("timer pause is still a working day", na.isWorkingDayYmd("2026-11-12", cal), true);
eq("Saturday works", na.isWorkingDayYmd("2026-11-14", cal), true);
eq("last 3 working days before Wed 18 (skips Tue)", na.lastWorkingDaysOffLeave("2026-11-18", 3, cal, []), ["2026-11-16", "2026-11-15", "2026-11-14"]);
eq("before Thu 12 Nov (skips Diwali 7-10, Tue 3)", na.lastWorkingDaysOffLeave("2026-11-12", 3, cal, []), ["2026-11-11", "2026-11-06", "2026-11-05"]);
eq("leave days are skipped", na.lastWorkingDaysOffLeave("2026-11-18", 3, cal, [{ employee_id: "x", start_date: "2026-11-14", end_date: "2026-11-15" }]), ["2026-11-16", "2026-11-13", "2026-11-12"]);

const emp = (id, o = {}) => ({ id, name: `Name ${id}`, is_active: true, role: "employee", department: "sales", joined: "2026-01-01", ...o });
const shifts = (o) => new Map(Object.entries(o).map(([k, v]) => [k, new Set(v)]));
const today = "2026-11-18";
const run = (employees, shiftDays, leaveRows = []) => na.employeesWithoutShift({ employees, leaveRows, shiftDays, todayYmd: today, cal }).map((x) => x.id);
eq("no shift for weeks -> flagged", run([emp("him")], shifts({ him: ["2026-10-15"] })), ["him"]);
eq("one shift in the window -> fine", run([emp("ok")], shifts({ ok: ["2026-11-15"] })), []);
eq("shift only today does not matter, window is before today", run([emp("t")], shifts({ t: ["2026-11-18"] })), ["t"]);
eq("on leave today -> no alert", run([emp("lv")], shifts({}), [{ employee_id: "lv", start_date: "2026-11-16", end_date: null }]), []);
eq("back from leave, shift before leave counts", run([emp("bk")], shifts({ bk: ["2026-11-13"] }), [{ employee_id: "bk", start_date: "2026-11-14", end_date: "2026-11-16" }]), []);
eq("inactive -> no alert", run([emp("in", { is_active: false })], shifts({})), []);
eq("admin / hr / payroll -> no alert", run([emp("a", { role: "admin" }), emp("h", { role: "hr" }), emp("p", { role: "payroll" }), emp("c", { role: "sales_coordinator" })], shifts({})), []);
eq("non-sales department -> no alert", run([emp("m", { department: "marketing" })], shifts({})), []);
eq("no department, team leader -> checked", run([emp("tl", { role: "team_leader", department: null })], shifts({})), ["tl"]);
eq("joined inside the window -> too new", run([emp("nw", { joined: "2026-11-15" })], shifts({})), []);
eq("joined just before the window -> checked", run([emp("ol", { joined: "2026-11-13" })], shifts({})), ["ol"]);
eq("test account excluded by id", run([emp("d970af89-063d-48b4-98aa-b89260fb3d87", { name: "QA login" })], shifts({})), []);
eq("test account excluded by name", run([emp("tt", { name: " Testing " })], shifts({})), []);
eq("a real 'Testing' surname is not a full-name match", run([emp("rt", { name: "Ravi Testing" })], shifts({})), ["rt"]);
eq("message", na.noShiftMessage([{ name: "Himanshu Singh", lastShift: "2026-10-15" }, { name: "Vivek S", lastShift: null }]),
  "2 employees without a shift for 3+ working days and no leave on record: Himanshu (last shift 2026-10-15), Vivek (no shift on record). Mark leave or check with them; their Data does not move on its own.");

// The job: once a day, one warning + one notification per Admin.
function fakeClient(tables) {
  const writes = { anomalies: [], notifications: [] };
  const from = (table) => {
    let rows = (tables[table] || []).slice();
    const q = {
      select: () => q, limit: () => q, order: () => q, not: () => q, gte: () => q,
      eq: (col, val) => { rows = rows.filter((r) => !(col in r) || r[col] === val); return q; },
      in: (col, vals) => { rows = rows.filter((r) => vals.includes(r[col])); return q; },
      insert: async (v) => { (table === "notification" ? writes.notifications : writes.anomalies).push(...(Array.isArray(v) ? v : [v])); return { error: null }; },
      then: (res) => res({ data: rows, error: null })
    };
    return q;
  };
  return { client: { from }, writes };
}
(async () => {
  const now = Date.parse("2026-11-18T05:00:00Z");
  const base = {
    employees: [
      { id: "him", name: "Himanshu Singh", is_active: true, role: "employee", department: "sales", created_at: "2026-06-01T00:00:00Z" },
      { id: "ok", name: "Rama", is_active: true, role: "employee", department: "sales", created_at: "2026-06-01T00:00:00Z" },
      { id: "adm", name: "Admin One", is_active: true, role: "admin", department: null, created_at: "2026-06-01T00:00:00Z" }
    ],
    employee_leave_periods: [],
    attendance: [{ employee_id: "ok", date: "2026-11-16" }, { employee_id: "him", date: "2026-10-15" }],
    employee_payroll_details: [],
    system_anomaly_log: []
  };
  let f = fakeClient(base);
  let r = await na.runNoShiftAlertOncePerDay(f.client, cal, now);
  eq("job flags one employee", [r.ran, r.flagged], [true, 1]);
  eq("one warning row", f.writes.anomalies.map((a) => [a.source, a.severity]), [["no_shift_alert", "warning"]]);
  eq("one notification per admin", f.writes.notifications.map((n) => [n.employee_id, n.type, n.title]), [["adm", "SYSTEM_ANOMALY_WARNING", "Employees not starting shifts"]]);
  f = fakeClient({ ...base, system_anomaly_log: [{ id: "1", source: "no_shift_alert" }] });
  r = await na.runNoShiftAlertOncePerDay(f.client, cal, now);
  eq("second run the same day does nothing", [r.ran, f.writes.anomalies.length, f.writes.notifications.length], [false, 0, 0]);
  f = fakeClient({ ...base, attendance: [{ employee_id: "ok", date: "2026-11-16" }, { employee_id: "him", date: "2026-11-15" }] });
  r = await na.runNoShiftAlertOncePerDay(f.client, cal, now);
  eq("everyone fine -> nothing written", [r.flagged, f.writes.anomalies.length, f.writes.notifications.length], [0, 0, 0]);

  // Guards
  const fn = read("supabase/functions/check-lead-reminders/index.ts");
  const at = fn.indexOf("runNoShiftAlertOncePerDay(supabase, workingCalendar)");
  if (at < 0) problems.push("check-lead-reminders must run the no-shift alert");
  else if (at < fn.indexOf("if (!isNotificationWindowOpen(workingCalendar))")) problems.push("the no-shift alert must run only inside the working-day notification window");
  if (!/try \{\s*await runNoShiftAlertOncePerDay/.test(fn)) problems.push("a failing no-shift alert must never stop the reminders");
  const lib = read("lib/noShiftAlert.ts");
  if (/from "@\//.test(lib) || /from "\.\/[a-zA-Z]+"/.test(lib)) problems.push("lib/noShiftAlert.ts is shared with Edge: relative .ts imports only");

  if (problems.length) {
    console.error("check-no-shift-alert: FAILED");
    for (const p of problems) console.error("  " + p);
    process.exit(1);
  }
  console.log("check-no-shift-alert: all known answers and guards pass.");
})();
