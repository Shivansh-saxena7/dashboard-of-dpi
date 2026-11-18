#!/usr/bin/env node
// Employee Home Phase 1 (2026-11-18): known answers for the flag and the "My leads" counts, plus guards that keep the
// Home numbers and /leads on the same rules. Run in prebuild. No DB.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];
require.extensions[".ts"] = (m, f) =>
  m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, f);
const eh = require(path.join(root, "lib/employeeHome.ts"));
const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// 1) Flag: off unless the row says so.
const E = "emp-1";
eq("no settings row = off", eh.homeModeAllows(null, E), false);
eq("column missing (SQL not applied) = off", eh.homeModeAllows({ auto_junk_enabled: true }, E), false);
eq("off", eh.homeModeAllows({ employee_home_mode: "off" }, E), false);
eq("unknown value = off", eh.homeModeAllows({ employee_home_mode: "ON" }, E), false);
eq("on", eh.homeModeAllows({ employee_home_mode: "on" }, E), true);
eq("on without employee = off", eh.homeModeAllows({ employee_home_mode: "on" }, null), false);
eq("pilot, listed", eh.homeModeAllows({ employee_home_mode: "admin_pilot", employee_home_pilot_ids: [E] }, E), true);
eq("pilot, not listed", eh.homeModeAllows({ employee_home_mode: "admin_pilot", employee_home_pilot_ids: ["x"] }, E), false);
eq("pilot, list missing", eh.homeModeAllows({ employee_home_mode: "admin_pilot" }, E), false);

// 2) Counts.
const at = "2026-11-18T05:00:00.000Z";
const fresh = (id, stage) => ({ id, status: "NEW", board_stage: stage, lead_history: [{ call_count: 0, assigned_at: at, last_activity_at: at }] });
const called = (id, stage) => ({ id, status: "CONNECTED", board_stage: stage, lead_history: [{ call_count: 1, first_call_at: at, outcome_at: at, assigned_at: at, last_activity_at: at }] });
const leads = [fresh("a", "LEADS"), fresh("b", null), called("c", "LEADS"), called("d", "FOLLOW_UP"), fresh("e", "FOLLOW_UP"), called("f", "VISIT"), called("g", "BOOKING")];
const c = eh.myLeadCounts(leads, null, Date.parse(at));
eq("total", c.total, 7);
eq("stages (null stage = Leads)", c.stages, { LEADS: 3, FOLLOW_UP: 2, VISIT: 1, BOOKING: 1 });
eq("New counts every tab, like Status = New", c.newCount, 3);
eq("empty list", eh.myLeadCounts([], null), { total: 0, stages: { LEADS: 0, FOLLOW_UP: 0, VISIT: 0, BOOKING: 0 }, newCount: 0, recyclingTomorrow: 0 });
eq("tab param", [eh.tabFromParam("VISIT"), eh.tabFromParam("HISTORY"), eh.tabFromParam(null)], ["VISIT", null, null]);
eq("links", [eh.HOME_LINKS.newLeads, eh.HOME_LINKS.recyclingTomorrow, eh.HOME_LINKS.stage("FOLLOW_UP")], ["/leads?filter=new", "/leads?filter=recycling-tomorrow", "/leads?tab=FOLLOW_UP"]);

// 3) Guards: same rules on both screens, old Home kept for flag off, no polling, no purple.
const list = read("components/LeadList.tsx");
if (!/stageCounts\(leads\)/.test(list)) problems.push("LeadList tab badges must use stageCounts from lib/employeeHome.ts");
if (!/sharedRecyclingTomorrowCutoffFor\(lead, workingCalendar\)/.test(list)) problems.push("LeadList Recycling tomorrow must use lib/employeeHome.ts");
if (!list.replace(/\s+/g, " ").includes("if (openLeadId) { setSelectedLeadId(openLeadId); }")) problems.push("LeadList must still open ?openLead= (result-save, call-return, moved-away)");
if (!/filterParam === "new"/.test(list) || !/tabFromParam\(searchParams\.get\("tab"\)\)/.test(list)) problems.push("LeadList must read ?filter=new and ?tab=");
const page = read("app/page.tsx");
if (!/newHome && employee\?\.id \? \(\s*<EmployeeHomeP1[\s\S]*?\) : \(\s*<PostsTrackingView/.test(page)) problems.push("app/page.tsx: flag off must render the old PostsTrackingView");
if (!/useEmployeeHomeMode\(employee\?\.id\)/.test(page)) problems.push("app/page.tsx must decide the Home with useEmployeeHomeMode");
if (/lead_engine_settings/.test(page)) problems.push("app/page.tsx: the login check must not wait for lead_engine_settings (old Home renders at once)");
const mode = read("lib/useEmployeeHomeMode.ts");
if (!/HOME_MODE_TIMEOUT_MS = 2000/.test(mode) || !/sessionStorage/.test(mode) || !/homeModeAllows\(/.test(mode)) problems.push("lib/useEmployeeHomeMode.ts: 2 s timeout, remembered per tab, decided by homeModeAllows");
for (const f of ["components/EmployeeHomeP1.tsx", "lib/useEmployeeHome.ts", "lib/employeeHome.ts", "lib/useEmployeeHomeMode.ts"]) {
  const s = read(f);
  if (/setInterval\(/.test(s)) problems.push(`${f}: no interval polling on Home`);
  if (/purple|violet|fuchsia|#8b5cf6|#7c3aed|#a855f7/i.test(s)) problems.push(`${f}: no purple / violet`);
}
const hook = read("lib/useEmployeeHome.ts");
if ((hook.match(/\.channel\(/g) || []).length !== 1) problems.push("lib/useEmployeeHome.ts: exactly one realtime channel");
if (!/fetchAllRows\(/.test(hook)) problems.push("lib/useEmployeeHome.ts: the leads read goes through fetchAllRows");

// 4) Phase 2 (2026-11-18): Needs attention, reminders today, Up next.
const T = Date.parse("2026-11-18T06:30:00Z"); // 12:00 IST
eq("IST day bounds", eh.istDayBounds(T), { start: Date.parse("2026-11-17T18:30:00Z"), end: Date.parse("2026-11-18T18:30:00Z") });
eq("IST day just after midnight IST", eh.istDayBounds(Date.parse("2026-11-18T18:31:00Z")).start, Date.parse("2026-11-18T18:30:00Z"));
const visit = (until, reason = "VISIT_LOCK", stage = "VISIT") => ({ id: "v", status: "CONNECTED", board_stage: stage, lead_history: [{ paused_until: until, pause_reason: reason }] });
eq("visit lock ends tonight 23:59 IST = due today", eh.isVisitDueToday(visit("2026-11-18T18:29:00Z"), T), true);
eq("visit lock ended yesterday = due", eh.isVisitDueToday(visit("2026-11-17T10:00:00Z"), T), true);
eq("visit lock ends tomorrow = not due", eh.isVisitDueToday(visit("2026-11-18T18:31:00Z"), T), false);
eq("snooze is not a visit", eh.isVisitDueToday(visit("2026-11-18T10:00:00Z", "SNOOZE"), T), false);
eq("visit lock outside Visit stage", eh.isVisitDueToday(visit("2026-11-18T10:00:00Z", "VISIT_LOCK", "FOLLOW_UP"), T), false);
const byLead = eh.remindersByLead([{ lead_id: "a", reminder_at: "2026-11-18T09:00:00Z" }, { lead_id: "a", reminder_at: "2026-11-18T05:00:00Z" }, { lead_id: "b", reminder_at: "bad" }]);
eq("earliest reminder per lead, bad dates dropped", [...byLead.entries()], [["a", Date.parse("2026-11-18T05:00:00Z")]]);
eq("home filter params", [eh.homeFilterFromParam("followup-overdue"), eh.homeFilterFromParam("reminders-today"), eh.homeFilterFromParam("visits-today"), eh.homeFilterFromParam("new"), eh.homeFilterFromParam("toString")], ["followup-overdue", "reminders-today", "visits-today", null, null]);
const fresh2 = (id, assigned) => ({ id, status: "NEW", board_stage: "LEADS", lead_history: [{ call_count: 0, assigned_at: assigned, last_activity_at: assigned }] });
const snoozed = { id: "s", status: "NEW", board_stage: "LEADS", lead_history: [{ call_count: 0, assigned_at: at, last_activity_at: at, paused_until: "2026-11-20T00:00:00Z", pause_reason: "SNOOZE" }] };
const order = eh.upNext([fresh2("n2", "2026-11-17T05:00:00Z"), fresh2("n1", "2026-11-16T05:00:00Z"), fresh2("r1", "2026-11-18T01:00:00Z"), snoozed, visit("2026-11-18T12:00:00Z")], { calendar: null, reminders: new Map([["r1", T]]), now: T }, 3);
eq("Up next: reminder first, then visit due, then oldest New; snoozed left out; limit", order.map((x) => `${x.lead.id}:${x.reason}`), ["r1:REMINDER", "v:VISIT", "n1:NEW"]);

const homeUi = read("components/EmployeeHomeP1.tsx");
if (!/rememberCalledCard\(lead\.id\);\s*if \(historyId\) logCallClick\(historyId, lead\.id\);/.test(homeUi) || !/href=\{`tel:\$\{lead\.mobile\}`\}/.test(homeUi)) problems.push("Up next Call must be LeadCard's Call: tel: link + rememberCalledCard + logCallClick");
if (!/registerActiveCallContext\(\{/.test(homeUi) || !/listType: "LEAD"/.test(homeUi)) problems.push("Up next must register the Home as the list on screen (call-return)");
if (/rpc\("log_call_click_atomic"|activeCall:v1/.test(homeUi)) problems.push("Up next must not write call clicks or the active call itself");
if (!/homeFilterLeads\(result, homeFilter,/.test(list) || !/useTodayReminders\(employeeId, homeFilter === "reminders-today"\)/.test(list)) problems.push("LeadList Home filters must use homeFilterLeads + useTodayReminders (same as the Home)");
if (!/attentionCounts\(leads, ctx\)/.test(hook) || !/fetchTodayReminders\(employeeId\)/.test(hook)) problems.push("Home Needs attention must use attentionCounts + fetchTodayReminders");
const rem = read("lib/todayReminders.ts");
if (!/\.eq\("employee_id", employeeId\)/.test(rem) || !/\.limit\(TODAY_REMINDERS_LIMIT\)/.test(rem) || !/\.gte\("reminder_at"/.test(rem) || !/\.lt\("reminder_at"/.test(rem)) problems.push("lib/todayReminders.ts: employee + today's range + limit");
if (/\.(update|insert|upsert|delete)\(/.test(rem + hook + homeUi)) problems.push("Home Phase 2 is read-only");
for (const f of ["lib/todayReminders.ts"]) {
  const s = read(f);
  if (/setInterval\(/.test(s)) problems.push(`${f}: no interval polling`);
  if (/purple|violet|fuchsia/i.test(s)) problems.push(`${f}: no purple / violet`);
}

if (problems.length) {
  console.error("check-employee-home FAILED:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("check-employee-home: OK");
