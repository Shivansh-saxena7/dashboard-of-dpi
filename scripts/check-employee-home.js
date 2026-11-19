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
eq("links", [eh.HOME_LINKS.newLeads, eh.HOME_LINKS.recyclingTomorrow, eh.HOME_LINKS.stage("FOLLOW_UP")], ["/leads?filter=new&from=home", "/leads?filter=recycling-tomorrow&from=home", "/leads?tab=FOLLOW_UP&from=home"]);

// 3) Guards: same rules on both screens, old Home kept for flag off, no polling, no purple.
const list = read("components/LeadList.tsx");
if (!/stageCounts\(leads\)/.test(list)) problems.push("LeadList tab badges must use stageCounts from lib/employeeHome.ts");
if (!/sharedRecyclingTomorrowCutoffFor\(lead, workingCalendar\)/.test(list)) problems.push("LeadList Recycling tomorrow must use lib/employeeHome.ts");
if (!list.replace(/\s+/g, " ").includes("if (openLeadId) { setSelectedLeadId(openLeadId); }")) problems.push("LeadList must still open ?openLead= (result-save, call-return, moved-away)");
if (!/filterParam === "new"/.test(list) || !/tabFromParam\(searchParams\.get\("tab"\)\)/.test(list)) problems.push("LeadList must read ?filter=new and ?tab=");
const page = read("app/page.tsx");
if (!/showNewHome && employee\?\.id \? \(\s*<EmployeeHomeP1[\s\S]*?\) : \(\s*<PostsTrackingView/.test(page)) problems.push("app/page.tsx: flag off must render the old PostsTrackingView");
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
if (!/homeFilterLeads\(result, homeFilter,/.test(list) || !/useTodayReminders\(employeeId, homeFilter === "reminders-today"( \|\| homeFilter === "reminders-missed")?( \|\| queueRequested)?\)/.test(list)) problems.push("LeadList Home filters must use homeFilterLeads + useTodayReminders (same as the Home)");
if (!/attentionCounts\(leads, ctx\)/.test(hook) || !/fetchTodayReminders\(employeeId\)/.test(hook)) problems.push("Home Needs attention must use attentionCounts + fetchTodayReminders");
const rem = read("lib/todayReminders.ts");
if (!/\.eq\("employee_id", employeeId\)/.test(rem) || !/\.limit\(TODAY_REMINDERS_LIMIT\)/.test(rem) || !/\.gte\("reminder_at"/.test(rem) || !/\.lt\("reminder_at"/.test(rem)) problems.push("lib/todayReminders.ts: employee + today's range + limit");
if (/\.(update|insert|upsert|delete)\(/.test(rem + hook + homeUi)) problems.push("Home Phase 2 is read-only");
for (const f of ["lib/todayReminders.ts", "lib/useTeamToday.ts"]) {
  const s = read(f);
  if (/setInterval\(/.test(s)) problems.push(`${f}: no interval polling`);
  if (/purple|violet|fuchsia/i.test(s)) problems.push(`${f}: no purple / violet`);
}

// 5) Phase 3 (2026-11-18): queue, team leader card, data-only variant.
const hist = (o) => ({ call_count: 0, assigned_at: at, last_activity_at: at, ...o });
const L = (id, status, stage, h, extra = {}) => ({ id, status, board_stage: stage, lead_history: [hist(h)], ...extra });
const qLeads = [
  L("new-late", "NEW", "LEADS", {}, { sla_deadline: "2026-11-19T05:00:00Z" }),
  L("new-early", "NEW", "LEADS", {}, { sla_deadline: "2026-11-18T09:00:00Z" }),
  L("pending-2", "CONNECTED", "FOLLOW_UP", { call_count: 2, outcome_at: "2026-11-18T03:00:00Z", last_call_click_at: "2026-11-18T05:00:00Z", last_activity_at: "2026-11-18T05:00:00Z" }),
  L("pending-1", "NOT_CONNECTED", "LEADS", { call_count: 1, outcome_at: null, last_call_click_at: "2026-11-18T04:00:00Z", last_activity_at: "2026-11-18T04:00:00Z" }),
  L("saved-after-click", "CONNECTED", "LEADS", { call_count: 1, outcome_at: "2026-11-18T05:30:00Z", last_call_click_at: "2026-11-18T05:00:00Z", last_activity_at: "2026-11-18T05:30:00Z" }),
  L("junk", "JUNK", "LEADS", {}),
  L("booked", "CONVERTED", "BOOKING", {}),
  L("snoozed", "NEW", "LEADS", { paused_until: "2026-11-20T00:00:00Z", pause_reason: "SNOOZE" }),
  L("rem", "CONNECTED", "FOLLOW_UP", { call_count: 1, outcome_at: at, last_activity_at: "2026-11-18T06:00:00Z" })
];
const q = eh.queueOrder(qLeads, { calendar: null, reminders: new Map([["rem", T]]), now: T });
eq("queue: pending (oldest click first), reminder, New (SLA first); closed, snoozed and saved-after-click left out", q.map((x) => `${x.lead.id}:${x.reason}`), ["pending-1:PENDING", "pending-2:PENDING", "rem:REMINDER", "new-early:NEW", "new-late:NEW"]);
eq("Up next = the queue's first rows", eh.upNext(qLeads, { calendar: null, reminders: new Map([["rem", T]]), now: T }, 2).map((x) => x.lead.id), ["pending-1", "pending-2"]);
eq("skip key is per employee and IST day", eh.queueSkipKey("e1", Date.parse("2026-11-18T18:31:00Z")), "homeQueueSkip:v1:e1:2026-11-19");
const D = (status, stage, calls) => ({ id: `${status}-${stage}-${calls}`, status, board_stage: stage, lead_history: [{ call_count: calls, assigned_at: at, last_activity_at: calls ? "2026-11-18T06:00:00Z" : at, first_call_at: calls ? at : null }] });
eq("data counts as DataCard: attempts only while still at risk", eh.dataCounts([D("NEW", "LEADS", 0), D("NOT_CONNECTED", "LEADS", 3), D("SWITCHED_OFF", null, 5), D("CONNECTED", "LEADS", 1), D("NEW", "FOLLOW_UP", 0)]), { total: 5, untouched: 2, callsLeft: 5, lastAttempt: 2, atRisk: 3 });

const leadList = read("components/LeadList.tsx");
if (!/queueOrder\(leads, \{ calendar: workingCalendar, reminders: todayReminders\.byLead, missed: todayReminders\.missed \}\)/.test(leadList)) problems.push("LeadList queue must use queueOrder with the same calendar + reminders as the Home");
const lq = read("lib/useListQueue.ts") + read("components/QueueBar.tsx");
if (!/sessionStorage\.setItem\(queueSkipKey\(employeeId\)/.test(lq)) problems.push("Queue Skip must stay in sessionStorage");
if (/supabase|\.rpc\(|fetch\(/.test(lq)) problems.push("Queue code must not call the database");
const dataList = read("components/DataList.tsx");
for (const [name, src] of [["LeadList", leadList], ["DataList", dataList]]) {
  if (!/listQueue\.onSaved\(selectedLead\.id\)/.test(src) || !/listQueue\.onClosed\(\)/.test(src)) problems.push(`${name}: queue advances only after the modal's own saved result (onUpdated)`);
}
if (!/listQueue\.start\(dataQueueOrder\(leads\)\)/.test(dataList)) problems.push("DataList queue must use dataQueueOrder (same as the Home count)");
const dq = eh.dataQueueOrder([D("NEW", "LEADS", 0), D("NOT_CONNECTED", "LEADS", 3), D("SWITCHED_OFF", "LEADS", 1), D("CONNECTED", "LEADS", 1), { ...D("NOT_CONNECTED", "LEADS", 2), id: "pending", lead_history: [{ call_count: 2, assigned_at: at, last_activity_at: at, last_call_click_at: "2026-11-18T06:00:00Z" }] }, D("JUNK", "LEADS", 0)]);
eq("data queue: pending, untouched, then fewest attempts left; closed and not-at-risk out", dq, ["pending", "NEW-LEADS-0", "NOT_CONNECTED-LEADS-3", "SWITCHED_OFF-LEADS-1"]);
if (!/const isTeamLeader = role === "team_leader" && Boolean\(teamId\);/.test(read("components/EmployeeHomeP1.tsx"))) problems.push("Team card only for role team_leader with a team");
const team = read("lib/useTeamToday.ts");
if (/\.rpc\(|service_role|\.(update|insert|upsert|delete)\(/.test(team)) problems.push("lib/useTeamToday.ts: read-only, client under RLS, no RPC");
if (!/\.limit\(TEAM_WAITING_LIMIT\)/.test(team) || !/fetchAllRows\(/.test(team)) problems.push("lib/useTeamToday.ts: bounded reads");
if (!/useEmployeeHome\.ts/.test("lib/useEmployeeHome.ts") || (hook.match(/\.channel\(/g) || []).length !== 1 || /\.channel\(/.test(team)) problems.push("Still exactly one realtime channel on the Home");

// 6) E4 (2026-11-19): non-sales, Called no result, missed reminders, urgent count, queue resume, Skip in the sheet.
const N = Date.parse("2026-11-19T06:30:00Z"); // Thu 12:00 IST
const split = eh.remindersByDay([
  { lead_id: "y", reminder_at: "2026-11-18T05:00:00Z" },
  { lead_id: "t", reminder_at: "2026-11-19T04:00:00Z" },
  { lead_id: "old", reminder_at: "2026-11-17T05:00:00Z" },
  { lead_id: "late", reminder_at: "2026-11-19T18:30:00Z" }
], N);
eq("reminders split by IST day: yesterday / today, older and tomorrow left out", [[...split.yesterday.keys()], [...split.today.keys()]], [["y"], ["t"]]);
const ml = (last) => ({ id: "y", status: "CONNECTED", board_stage: "FOLLOW_UP", lead_history: [{ last_activity_at: last }] });
const yMap = new Map([["y", Date.parse("2026-11-18T05:00:00Z")]]);
eq("missed reminder: nothing done since", eh.isMissedReminder(ml("2026-11-17T10:00:00Z"), yMap), true);
eq("missed reminder: worked after the reminder = not missed", eh.isMissedReminder(ml("2026-11-18T06:00:00Z"), yMap), false);
const pend = (status, stage, extra = {}) => ({ id: "p", status, board_stage: stage, lead_history: [{ call_count: 1, last_call_click_at: "2026-11-19T05:00:00Z", outcome_at: null, ...extra }] });
const pctx = { calendar: null, reminders: new Map(), missed: new Map(), now: N };
eq("Called, no result: open lead", eh.matchesHomeFilter(pend("NOT_CONNECTED", "LEADS"), "pending-result", pctx), true);
eq("Called, no result: booked lead left out", eh.matchesHomeFilter(pend("CONVERTED", "BOOKING"), "pending-result", pctx), false);
eq("Called, no result: result saved after the click = done", eh.matchesHomeFilter(pend("CONNECTED", "LEADS", { outcome_at: "2026-11-19T05:10:00Z" }), "pending-result", pctx), false);
eq("urgent summary", eh.queueSummary([{ reason: "PENDING" }, { reason: "NEW" }, { reason: "OVERDUE" }, { reason: "NEW" }]), { urgent: 2, total: 4 });
eq("stored queue: today kept", eh.parseStoredQueue(JSON.stringify({ day: "2026-11-19", ids: ["a", "b"], index: 1 }), N), { ids: ["a", "b"], index: 1 });
eq("stored queue: other day dropped", eh.parseStoredQueue(JSON.stringify({ day: "2026-11-18", ids: ["a"], index: 0 }), N), null);
eq("stored queue: finished dropped", eh.parseStoredQueue(JSON.stringify({ day: "2026-11-19", ids: ["a"], index: 1 }), N), null);
eq("stored queue: junk dropped", eh.parseStoredQueue("{bad", N), null);

const pageSrc = read("app/page.tsx");
if (!/const showNewHome = newHome && !\(employee\?\.department && employee\.department !== "sales"\);/.test(pageSrc) || !/\{showNewHome && employee\?\.id \? \(/.test(pageSrc)) problems.push("app/page.tsx: the new Home only for Sales (non-sales keep the old Home)");
for (const f of ["components/LeadDetailModal.tsx", "components/DataDetailModal.tsx"]) {
  const s = read(f);
  // Skip in the sheet is display only: the prop, the signature and the one button - nothing else uses it.
  // prop, signature, the JSX comment, the condition, the onClick
  if ((s.match(/onQueueSkip/g) || []).length !== 5) problems.push(`${f}: onQueueSkip must stay an optional prop + one button`);
}
for (const [name, src] of [["LeadList", read("components/LeadList.tsx")], ["DataList", read("components/DataList.tsx")]]) {
  if (!/key=\{selectedLead\.id\}/.test(src)) problems.push(`${name}: the sheet is keyed by lead (nothing typed carries over to the next lead)`);
  if (!/entry\.leadId === selectedLeadId\) listQueue\.resumeFor\(selectedLeadId\)/.test(src)) problems.push(`${name}: queue resumes only for the active call's lead`);
}
const lqSrc = read("lib/useListQueue.ts");
if (!/localStorage\.setItem\(key/.test(lqSrc) || !/queueDay\(\)/.test(lqSrc)) problems.push("lib/useListQueue.ts: today's queue kept in localStorage");

// 7) E5 (2026-11-19) polish: everything behind the flag; shared components keep their old look when it is off.
eq("fromHome adds the marker", [eh.fromHome("/data"), eh.fromHome("/leads?queue=1")], ["/data?from=home", "/leads?queue=1&from=home"]);
const ssc = read("components/StartShiftCard.tsx");
if (!/compactWhenIdle = false/.test(ssc) || !/!started && !ended && !idleCompact && \(/.test(ssc)) problems.push("StartShiftCard: compactWhenIdle off by default; the idle strip has no Start button");
if (!/<StartShiftCard employeeId=\{employee\.id\} compactWhenIdle=\{showNewHome\} \/>/.test(pageSrc)) problems.push("app/page.tsx: compact Start Shift only with the new Home");
const rcs = read("components/ResumeCallStrip.tsx");
if (/supabase|\.from\(|\.rpc\(/.test(rcs) || !/rememberedHomeMode\(employeeId\)/.test(rcs) || !/\{newHome \? "Drop call" : "Skip"\}/.test(rcs)) problems.push("ResumeCallStrip: 'Drop call' only when the Home remembered the flag on; no read of its own");
const qb = read("components/QueueBar.tsx");
if (!/aria-live="polite"/.test(qb) || !/Skip lead/.test(qb)) problems.push("QueueBar: aria-live + 'Skip lead'");
const ui5 = read("components/EmployeeHomeP1.tsx");
if (/opacity-80/.test(ui5)) problems.push("Home: no opacity on labels (contrast)");
if (/up-next-call[\s\S]{0,200}bg-blue-600/.test(ui5)) problems.push("Home: Call buttons are outline, only Start is solid");
if (!/Waiting to assign/.test(ui5) || /"To assign"/.test(ui5)) problems.push("Home: 'Waiting to assign'");
if (!/useReducedMotion/.test(ui5)) problems.push("Home: fade respects reduced motion");
if (!/reportClientError\("home:leads"/.test(read("lib/useEmployeeHome.ts")) || !/reportClientError\("home:team"/.test(team.length ? read("lib/useTeamToday.ts") : "")) problems.push("Home cards report their load failures");
for (const [name, src] of [["LeadList", read("components/LeadList.tsx")], ["DataList", read("components/DataList.tsx")]]) {
  if (!/data-testid="back-to-home"/.test(src) || !/searchParams\.get\("from"\) === "home"/.test(src)) problems.push(`${name}: Back to Home chip when coming from the Home`);
}

// 8) E6 (2026-11-19): leave strip, snooze ends today, Given step, mixed DATA count, Call Quality card.
const tue = { weeklyOffDay: 2, ranges: [], timersEnabled: true };
const tanuRows = [{ employee_id: "t", start_date: "2026-11-12", end_date: "2026-11-15" }];
eq("leave: on leave", eh.leaveStatus(tanuRows, "t", "2026-11-13", tue), { kind: "ON_LEAVE", until: "2026-11-15" });
eq("leave: grace Mon 16 until Wed 18 (Tue off)", eh.leaveStatus(tanuRows, "t", "2026-11-16", tue), { kind: "GRACE", until: "2026-11-18" });
eq("leave: Tue 17 weekly off is not a grace day", eh.leaveStatus(tanuRows, "t", "2026-11-17", tue), null);
eq("leave: grace Wed 18", eh.leaveStatus(tanuRows, "t", "2026-11-18", tue), { kind: "GRACE", until: "2026-11-18" });
eq("leave: Thu 19 back to normal", eh.leaveStatus(tanuRows, "t", "2026-11-19", tue), null);
eq("leave: coming up within 7 days", eh.leaveStatus(tanuRows, "t", "2026-11-08", tue), { kind: "UPCOMING", from: "2026-11-12", to: "2026-11-15" });
eq("leave: not yet shown 8+ days ahead", eh.leaveStatus(tanuRows, "t", "2026-11-04", tue), null);
const openRows = [{ employee_id: "o", start_date: "2026-11-20", end_date: null }];
eq("leave: open-ended, on leave", eh.leaveStatus(openRows, "o", "2026-11-25", tue), { kind: "ON_LEAVE", until: null });
eq("leave: someone else's leave ignored", eh.leaveStatus(tanuRows, "x", "2026-11-13", tue), null);
eq("leave text", [eh.leaveStatusText({ kind: "GRACE", until: "2026-11-18" }), eh.leaveStatusText({ kind: "ON_LEAVE", until: null })], ["Back from leave. Until 18 Nov your lead timers stay paused and no recycled leads are given to you.", "On leave. Your lead timers are paused."]);
const sn = (until, reason = "SNOOZE") => ({ id: "s", status: "CONNECTED", board_stage: "FOLLOW_UP", lead_history: [{ paused_until: until, pause_reason: reason }] });
eq("snooze ends later today", eh.isSnoozeEndingToday(sn("2026-11-19T12:00:00Z"), N), true);
eq("snooze ended earlier today", eh.isSnoozeEndingToday(sn("2026-11-18T19:00:00Z"), N), true);
eq("snooze ends tomorrow", eh.isSnoozeEndingToday(sn("2026-11-19T18:31:00Z"), N), false);
eq("visit lock is not a snooze", eh.isSnoozeEndingToday(sn("2026-11-19T12:00:00Z", "VISIT_LOCK"), N), false);
const gq = eh.queueOrder([fresh2("n1", "2026-11-16T05:00:00Z"), fresh2("g1", "2026-11-17T05:00:00Z")], { calendar: null, reminders: new Map(), given: new Set(["g1"]), now: N });
eq("queue: Given to you before plain New", gq.map((x) => `${x.lead.id}:${x.reason}`), ["g1:GIVEN", "n1:NEW"]);

// Call Quality card = My Call Quality's top: reference copy of components/MyCallQuality.tsx lines 108-111 + ScoreLight's
// "band ?? Not enough data yet" (main 3b3fb25), against callQualityCardModel.
const { bandOf } = require(path.join(root, "lib/callQuality.ts"));
const refCq = (summary) => {
  const me = summary.employees[0];
  const lead = me?.by_card_type.LEAD;
  const data = me?.by_card_type.DATA;
  const showData = (data?.dial_clicks ?? 0) > 0;
  const showLead = (lead?.dial_clicks ?? 0) > 0 || !showData;
  const out = [];
  if (showLead) out.push([showData ? "Lead cards" : null, bandOf(lead?.genuine_score ?? null) ?? "Not enough data yet"]);
  if (showData) out.push(["Data cards", bandOf(data?.genuine_score ?? null) ?? "Not enough data yet"]);
  return out;
};
const cqCases = [
  { LEAD: { dial_clicks: 40, genuine_score: 86 } },
  { LEAD: { dial_clicks: 40, genuine_score: 70 }, DATA: { dial_clicks: 12, genuine_score: 55 } },
  { DATA: { dial_clicks: 20, genuine_score: 80 } },
  { LEAD: { dial_clicks: 3, genuine_score: null } },
  {}
];
for (const [i, by] of cqCases.entries()) {
  const summary = { enforced: false, estimated: i % 2 === 0, employees: [{ by_card_type: by }] };
  const m = eh.callQualityCardModel(summary);
  eq(`Call Quality card case ${i}`, m.lines.map((l) => [l.label, l.bandText]), refCq(summary));
  eq(`Call Quality card case ${i} notes`, [m.enforced, m.estimated], [false, i % 2 === 0]);
}
eq("Call Quality card: bands", eh.callQualityCardModel({ enforced: true, estimated: false, employees: [{ by_card_type: { LEAD: { dial_clicks: 9, genuine_score: 59 } } }] }).lines[0].bandText, "Red");
eq("Call Quality card: nothing to show without a summary", eh.callQualityCardModel(null), null);

const ctxHook = read("lib/useHomeContext.ts");
const has = (src, text) => src.includes(text);
if (!has(ctxHook, '.eq("employee_id", employeeId)') || !has(ctxHook, ".limit(HOME_LEAVE_LIMIT)")) problems.push("useHomeContext: own leave rows, bounded");
if (!has(ctxHook, 'rpc("get_call_quality_summary", { p_employee_id: employeeId,') || has(ctxHook, "get_call_quality_details")) problems.push("useHomeContext: the summary RPC for this employee only (no details)");
if (/\.(update|insert|upsert|delete)\(|setInterval\(|\.channel\(/.test(ctxHook)) problems.push("useHomeContext: read-only, no polling, no channel");
const hook6 = read("lib/useEmployeeHome.ts");
if (!has(hook6, "useGivenLeadContext(employeeId)") || !has(hook6, "givenFilterLeads(leads, givenContext.byLeadId)")) problems.push("Given to you: same hook + filter as /leads Given by admin");
if (!has(hook6, '{ count: "exact", head: true }') || !has(hook6, '.eq("lead_type", "DATA")')) problems.push("Mixed DATA count: one HEAD count with /data's filters");
const ui6 = read("components/EmployeeHomeP1.tsx");
if (!has(ui6, "<StatusNotes estimated={cq.estimated} enforced={cq.enforced} />")) problems.push("Call Quality card: the same Learning week / Estimated notes as My Call Quality");
if (!/filterParam === "given"/.test(read("components/LeadList.tsx"))) problems.push("LeadList: ?filter=given opens the Given by admin filter");

if (problems.length) {
  console.error("check-employee-home FAILED:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("check-employee-home: OK");
