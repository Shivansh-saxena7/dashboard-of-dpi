#!/usr/bin/env node
// Leave days do not count on lead timers (2026-11-12): known answers, run in prebuild and by check-recycle-deploy. No DB.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];
require.extensions[".ts"] = (m, f) =>
  m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, f);
const { leaveRangesFor, ownerCalendar, leaveAdjustedSlaDeadline } = require(path.join(root, "lib/ownerLeaveCalendar.ts"));
const { getRecycleCutoff, calculateSLAStatus } = require(path.join(root, "lib/calculateSLAStatus.ts"));

const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const IST = (s) => new Date(s + "+05:30").toISOString();
const DAY = 24 * 3600 * 1000;
const plain = { weeklyOffDay: null, ranges: [], timersEnabled: true };
const tue = { weeklyOffDay: 2, ranges: [], timersEnabled: true };
const off = { weeklyOffDay: 2, ranges: [], timersEnabled: false };
const TODAY = "2026-11-20";
const tanu3 = [{ employee_id: "tanu", start_date: "2026-11-04", end_date: "2026-11-06" }];

const followUp = (lastActivity) => ({ status: "CONNECTED", recycle_count: 0, lead_type: "LEAD", board_stage: "FOLLOW_UP", sla_deadline: null, assigned_at: IST("2026-10-20T10:00:00"), last_activity_at: IST(lastActivity), paused_until: null, pause_reason: null, call_count: 1 });
const cut = (lead, cal, outcome = null) => { const r = getRecycleCutoff(lead, outcome, false, cal); return r ? r.cutoffAt.toISOString() : null; };

// 3 leave days after the clock started: the due date moves 3 days on
const lead = followUp("2026-11-02T12:00:00");
const before = cut(lead, plain);
const after = cut(lead, ownerCalendar(plain, tanu3, "tanu", TODAY));
eq("no leave: 6 days after the last activity", before, IST("2026-11-08T12:00:00"));
eq("3 leave days: due 3 days later", after, IST("2026-11-11T12:00:00"));
// A weekly off inside the leave is not counted twice
eq("leave over a weekly off: still 3 working days", cut(lead, ownerCalendar(tue, [{ employee_id: "tanu", start_date: "2026-11-02", end_date: "2026-11-04" }], "tanu", TODAY)), cut(followUp("2026-11-02T12:00:00"), { ...tue, ranges: [{ id: null, startsAt: Date.parse(IST("2026-11-02T00:00:00")), endsAt: Date.parse(IST("2026-11-05T00:00:00")), reason: "x", kind: "HOLIDAY" }] }));
// Leave fully before the clock started: nothing changes
eq("leave before the last activity: unchanged", cut(followUp("2026-11-09T12:00:00"), ownerCalendar(plain, tanu3, "tanu", TODAY)), cut(followUp("2026-11-09T12:00:00"), plain));
// Two leaves add up
const two = [...tanu3, { employee_id: "tanu", start_date: "2026-11-09", end_date: "2026-11-09" }];
eq("two leaves: 3 + 1 days", cut(lead, ownerCalendar(plain, two, "tanu", TODAY)), IST("2026-11-12T12:00:00"));
// Open-ended leave runs to the end of today
const open = [{ employee_id: "suraj", start_date: "2026-11-04", end_date: null }];
eq("open-ended: counted up to the end of today", leaveRangesFor(open, "suraj", "2026-11-06").map((r) => [new Date(r.startsAt).toISOString(), new Date(r.endsAt).toISOString()]), [[IST("2026-11-04T00:00:00"), IST("2026-11-07T00:00:00")]]);
eq("open-ended leave moves the due date like a closed one", cut(lead, ownerCalendar(plain, open, "suraj", "2026-11-06")), IST("2026-11-11T12:00:00"));
eq("a leave not started yet is ignored", leaveRangesFor([{ employee_id: "x", start_date: "2026-12-01", end_date: null }], "x", TODAY), []);
// Owner changed: only the current owner's leave counts
eq("another employee's leave: no effect", cut(lead, ownerCalendar(plain, tanu3, "kashish", TODAY)), before);
eq("no owner: no effect", ownerCalendar(plain, tanu3, null, TODAY), plain);
eq("timers switch off: calendar unchanged", ownerCalendar(off, tanu3, "tanu", TODAY), off);
// Cooldown (Not connected, 3 days) pauses too
const nc = { ...followUp("2026-11-03T12:00:00"), status: "NOT_CONNECTED", board_stage: "LEADS", assigned_at: IST("2026-11-03T11:00:00"), last_activity_at: IST("2026-11-03T11:00:00") };
eq("cooldown without leave", cut(nc, plain, IST("2026-11-03T12:00:00")), IST("2026-11-06T12:00:00"));
eq("cooldown with 3 leave days", cut(nc, ownerCalendar(plain, tanu3, "tanu", TODAY), IST("2026-11-03T12:00:00")), IST("2026-11-09T12:00:00"));

// Stored SLA deadline of a NEW lead
const sla = (rows, assigned, deadline, cal = plain) => leaveAdjustedSlaDeadline(cal, rows, "tanu", TODAY, IST(assigned), IST(deadline));
eq("SLA: one leave day inside moves it one day", sla([{ employee_id: "tanu", start_date: "2026-11-10", end_date: "2026-11-10" }], "2026-11-09T12:00:00", "2026-11-10T12:00:00"), IST("2026-11-11T12:00:00"));
eq("SLA: a leave longer than what was left is counted in full", sla([{ employee_id: "tanu", start_date: "2026-11-10", end_date: "2026-11-12" }], "2026-11-09T12:00:00", "2026-11-10T12:00:00"), IST("2026-11-13T12:00:00"));
eq("SLA: leave after the deadline changes nothing", sla([{ employee_id: "tanu", start_date: "2026-11-12", end_date: "2026-11-13" }], "2026-11-09T12:00:00", "2026-11-10T12:00:00"), IST("2026-11-10T12:00:00"));
eq("SLA: leave before the assignment changes nothing", sla([{ employee_id: "tanu", start_date: "2026-11-05", end_date: "2026-11-06" }], "2026-11-09T12:00:00", "2026-11-10T12:00:00"), IST("2026-11-10T12:00:00"));
eq("SLA: no deadline stays empty", leaveAdjustedSlaDeadline(plain, tanu3, "tanu", TODAY, null, null), null);
eq("SLA: another owner's leave changes nothing", leaveAdjustedSlaDeadline(plain, tanu3, "kashish", TODAY, IST("2026-11-03T12:00:00"), IST("2026-11-05T12:00:00")), IST("2026-11-05T12:00:00"));
eq("SLA: weekly off inside the leave is not counted twice", sla([{ employee_id: "tanu", start_date: "2026-11-10", end_date: "2026-11-10" }], "2026-11-09T12:00:00", "2026-11-11T12:00:00", tue), IST("2026-11-11T12:00:00"));

// The sweep status agrees: due without leave, not due with it
const now = Date.parse(IST("2026-11-09T12:00:00"));
const RealNow = Date.now;
Date.now = () => now;
const RealDate = Date;
global.Date = class extends RealDate { constructor(...a) { if (a.length === 0) super(now); else super(...a); } static now() { return now; } };
eq("status without leave: recycle ready", calculateSLAStatus(lead, null, 0, false, false, plain), "FOLLOWUP_INACTIVITY_RECYCLE_READY");
eq("status with 3 leave days: still in the window", calculateSLAStatus(lead, null, 0, false, false, ownerCalendar(plain, tanu3, "tanu", TODAY)), "FOLLOWUP_INACTIVITY_WARNING");
global.Date = RealDate;
Date.now = RealNow;

// The sweep uses it for every lead
const fn = read("supabase/functions/recycle-stale-leads/index.ts");
if (!fn.includes("ownerCalendar(workingCalendar, leaveHistoryRows, lead.current_owner_id, leaveToday)")) problems.push("the sweep must use the owner's leave calendar");
if (!fn.includes("leaveAdjustedSlaDeadline(workingCalendar, leaveHistoryRows, lead.current_owner_id, leaveToday, activeHistory.assigned_at, lead.sla_deadline)")) problems.push("the sweep must move a NEW lead's SLA deadline past the owner's leave");

if (problems.length) {
  console.error("check-owner-leave-calendar: FAILED");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log("check-owner-leave-calendar: all known answers pass.");
