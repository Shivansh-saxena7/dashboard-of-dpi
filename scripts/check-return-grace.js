#!/usr/bin/env node
// Return grace (2026-11-14): known answers + sweep guards, run in prebuild and by check-recycle-deploy. No DB.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];
require.extensions[".ts"] = (m, f) =>
  m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, f);
const oc = require(path.join(root, "lib/ownerLeaveCalendar.ts"));
const { getRecycleCutoff } = require(path.join(root, "lib/calculateSLAStatus.ts"));
const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const IST = (s) => new Date(s + "+05:30").toISOString();
const ISTms = (ymd) => Date.parse(`${ymd}T00:00:00+05:30`);
const tue = { weeklyOffDay: 2, ranges: [], timersEnabled: true };
const diwali = { weeklyOffDay: 2, ranges: [{ id: null, startsAt: ISTms("2026-11-07"), endsAt: ISTms("2026-11-11"), reason: "Diwali", kind: "HOLIDAY" }], timersEnabled: true };

eq("grace is 2 working days", oc.RETURN_GRACE_WORKING_DAYS, 2);

// 1) Which days are grace
const tanu = [{ employee_id: "tanu", start_date: "2026-11-12", end_date: "2026-11-15" }];
eq("Tanu back Mon 16: grace Mon 16 + Wed 18 (Tue off)", oc.returnGraceDays(tanu, "tanu", tue), ["2026-11-16", "2026-11-18"]);
const raja = [{ employee_id: "raja", start_date: "2026-11-04", end_date: "2026-11-22" }];
eq("Raja back after Sun 22: grace Mon 23 + Wed 25", oc.returnGraceDays(raja, "raja", tue), ["2026-11-23", "2026-11-25"]);
eq("holidays are not grace days", oc.returnGraceDays([{ employee_id: "x", start_date: "2026-11-04", end_date: "2026-11-06" }], "x", diwali), ["2026-11-11", "2026-11-12"]);
const two = [{ employee_id: "y", start_date: "2026-11-01", end_date: "2026-11-03" }, { employee_id: "y", start_date: "2026-11-05", end_date: "2026-11-06" }];
eq("two leaves: a leave day inside the first grace is skipped", oc.returnGraceDays(two, "y", tue), ["2026-11-04", "2026-11-07", "2026-11-08"]);
eq("open-ended leave: no grace yet", oc.returnGraceDays([{ employee_id: "s", start_date: "2026-08-27", end_date: null }], "s", tue), []);
eq("grace 0: none", oc.returnGraceDays(tanu, "tanu", tue, 0), []);

// 2) Who is in grace today (receiver pool)
const rows = [...tanu, ...raja, { employee_id: "suraj", start_date: "2026-08-27", end_date: null }];
eq("Mon 16: Tanu in grace", [...oc.employeesInReturnGrace(rows, "2026-11-16", tue)], ["tanu"]);
eq("Tue 17 (weekly off): nobody", [...oc.employeesInReturnGrace(rows, "2026-11-17", tue)], []);
eq("Wed 18: Tanu still in grace", [...oc.employeesInReturnGrace(rows, "2026-11-18", tue)], ["tanu"]);
eq("Thu 19: Tanu back in the pool", [...oc.employeesInReturnGrace(rows, "2026-11-19", tue)], []);
eq("on leave today is not grace", [...oc.employeesInReturnGrace(rows, "2026-11-20", tue)], []);
eq("Mon 23: Raja in grace, nobody else", [...oc.employeesInReturnGrace(rows, "2026-11-23", tue)], ["raja"]);

// 3) Timers of the returning owner's own leads
const followUp = (lastActivity) => ({ status: "CONNECTED", recycle_count: 0, lead_type: "LEAD", board_stage: "FOLLOW_UP", sla_deadline: null, assigned_at: IST("2026-11-01T10:00:00"), last_activity_at: IST(lastActivity), paused_until: null, pause_reason: null, call_count: 1 });
const cut = (lead, cal, outcome = null) => { const r = getRecycleCutoff(lead, outcome, false, cal); return r ? r.cutoffAt.toISOString() : null; };
const lead = followUp("2026-11-11T12:00:00");
const today = "2026-11-18";
const leaveOnly = cut(lead, oc.ownerCalendar(tue, tanu, "tanu", today, 0));
const withGrace = cut(lead, oc.ownerCalendar(tue, tanu, "tanu", today));
eq("inactivity: leave only (6 working days from Wed 11 12:00, leave 12-15, Tue off)", leaveOnly, IST("2026-11-22T12:00:00"));
eq("inactivity: + 2 grace days (Mon 16, Wed 18) = 2 working days later", withGrace, IST("2026-11-25T12:00:00"));
eq("on Mon 16 only that grace day counts so far", cut(lead, oc.ownerCalendar(tue, tanu, "tanu", "2026-11-16")), IST("2026-11-23T12:00:00"));
const nc = { ...followUp("2026-11-11T12:00:00"), status: "NOT_CONNECTED", board_stage: "LEADS", assigned_at: IST("2026-11-11T11:00:00"), last_activity_at: IST("2026-11-11T11:00:00") };
eq("cooldown also waits for the grace days", cut(nc, oc.ownerCalendar(tue, tanu, "tanu", today), IST("2026-11-11T12:00:00")), cut(nc, oc.ownerCalendar(tue, tanu, "tanu", today, 0), IST("2026-11-11T12:00:00")) === null ? null : IST("2026-11-21T12:00:00"));
eq("another owner: unchanged", cut(lead, oc.ownerCalendar(tue, tanu, "rama", today)), cut(lead, tue));
eq("SLA NEW: grace moves the deadline 2 more working days",
  oc.leaveAdjustedSlaDeadline(tue, tanu, "tanu", today, IST("2026-11-11T11:00:00"), IST("2026-11-12T11:00:00")),
  IST("2026-11-19T11:00:00"));
eq("SLA NEW: leave only", oc.leaveAdjustedSlaDeadline(tue, tanu, "tanu", today, IST("2026-11-11T11:00:00"), IST("2026-11-12T11:00:00"), 0), IST("2026-11-16T11:00:00"));

// 4) Sweep guards
const fn = read("supabase/functions/recycle-stale-leads/index.ts");
if (!fn.includes("const returnGraceIds = employeesInReturnGrace(leaveHistoryRows, leaveToday, workingCalendar);")) problems.push("the sweep must work out who is in return grace today");
if (!fn.includes("shiftStartedEmployeeIds.has(employee.id) && !returnGraceIds.has(employee.id)")) problems.push("round robin must leave out employees in return grace");
if (!/shiftStartedEmployeeIds\.has\(id\) &&\s*!returnGraceIds\.has\(id\) &&/.test(fn)) problems.push("project-rule groups must leave out employees in return grace");
if (!fn.includes("ownerCalendar(workingCalendar, leaveHistoryRows, lead.current_owner_id, leaveToday)")) problems.push("timers must use the owner calendar (with grace by default)");
if (!fn.includes("pickRecycleOwnerCapped(")) problems.push("the per-owner cap must stay");

if (problems.length) {
  console.error("check-return-grace: FAILED");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log("check-return-grace: all known answers and guards pass.");
