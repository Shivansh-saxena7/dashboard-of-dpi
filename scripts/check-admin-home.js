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
if (!has(page, "useAdminHomeMode()") || !has(page, "mode.on && mode.employeeId ? <AdminHomeA1 employeeId={mode.employeeId} /> : <AdminSocialDashboard />")) problems.push("app/admin/page.tsx: new Home only when the flag is on; otherwise the old dashboard");
const social = read("components/AdminSocialDashboard.tsx");
// After A0 (main, 2026-11-20) the old dashboard never polls: it loads on open, date change, foreground (>= 1 min) or Refresh.
if (!has(social, "{ poll = true }") || social.includes("setInterval(") || !has(social, "visibilitychange") || !has(social, "admin-dashboard-refresh")) problems.push("AdminSocialDashboard: A0 loading (no interval, foreground reload, Refresh button); poll prop kept for callers");
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

// 6) A2 (2026-11-19): Today so far windows, team status (HR attendance's rule), call quality bands, workload.
eq("today windows", ah.todayWindows(Date.parse("2026-11-19T06:30:00Z")), {
  today: { from: "2026-11-18T18:30:00.000Z", to: "2026-11-19T06:30:00.000Z" },
  yesterday: { from: "2026-11-17T18:30:00.000Z", to: "2026-11-18T06:30:00.000Z" }
});
eq("delta", [ah.deltaText(212, 194), ah.deltaText(171, 180), ah.deltaText(0, 0)], [
  { text: "▲ 18 more", dir: "up" }, { text: "▼ 9 fewer", dir: "down" }, { text: "same as yesterday", dir: "same" }
]);
const E = (id, name, role = "employee", department = "sales") => ({ id, name, is_active: true, role, department });
const employees = [E("on", "On"), E("late", "Late"), E("half", "Half"), E("ended", "Ended"), E("leave", "Leave"), E("grace", "Grace"), E("none", "None"), E("t", "Testing"), E("adm", "Admin", "admin", null), E("mkt", "Mkt", "employee", "marketing")];
const IST = (hhmm) => `2026-11-16T${hhmm}:00+05:30`;
const attendance = [
  { employee_id: "on", shift_start_at: IST("10:32"), shift_end_at: null, attendance_type: "FULL_DAY" },
  { employee_id: "late", shift_start_at: IST("10:53"), shift_end_at: null, attendance_type: "FULL_DAY" },
  { employee_id: "half", shift_start_at: IST("13:20"), shift_end_at: null, attendance_type: "HALF_DAY_SECOND" },
  { employee_id: "ended", shift_start_at: IST("10:31"), shift_end_at: IST("18:31"), attendance_type: "FULL_DAY" }
];
const leaveRows = [{ employee_id: "leave", start_date: "2026-11-15", end_date: "2026-11-18" }, { employee_id: "grace", start_date: "2026-11-12", end_date: "2026-11-15" }];
const cutoffs = { first_half_ontime_cutoff: "10:35:00", second_half_ontime_cutoff: "13:30:00" };
const calTue = { weeklyOffDay: 2, ranges: [], timersEnabled: true };
const at = (hhmm, ymd = "2026-11-16") => Date.parse(`${ymd}T${hhmm}:00+05:30`);
const team = (nowMs, ymd = "2026-11-16") => ah.teamStatus({ employees, attendance, leaveRows, cutoffs, firstWindowEnd: "11:30:00", todayYmd: ymd, nowMs, cal: calTue });
eq("team states Mon 14:00 (order: needs a look first)", team(at("14:00")).map((m) => `${m.id}:${m.state}`), ["none:NOT_STARTED", "late:LATE", "grace:IN_GRACE", "half:ON_SHIFT", "on:ON_SHIFT", "ended:SHIFT_ENDED", "leave:ON_LEAVE"]);
eq("before 11:30 not started is not yet a problem", team(at("10:45")).find((m) => m.id === "none").state, "NOT_STARTED_YET");
eq("Tuesday = day off", ah.teamStatus({ employees, attendance: [], leaveRows: [], cutoffs, firstWindowEnd: "11:30:00", todayYmd: "2026-11-17", nowMs: at("14:00", "2026-11-17"), cal: calTue }).every((m) => m.state === "DAY_OFF"), true);
// HR attendance parity: on shift / late = calculateDailyHrmsStatus over today's attendance rows (the HR page's rule).
const { calculateDailyHrmsStatus } = require(path.join(root, "lib/calculateHrmsAttendanceStatus.ts"));
const hrLate = attendance.filter((a) => !a.shift_end_at && calculateDailyHrmsStatus(a, cutoffs) === "LATE_COMING").length;
const counts = ah.teamCounts(team(at("14:00")));
eq("team counts = HR rule", [counts.late, counts.onShift], [hrLate, attendance.filter((a) => !a.shift_end_at).length]);
eq("call quality bands (Lead when Lead dials, else Data)", [...ah.bandsFromSummary({ employees: [
  { employee_id: "a", by_card_type: { LEAD: { dial_clicks: 40, genuine_score: 86 }, DATA: { dial_clicks: 5, genuine_score: 40 } } },
  { employee_id: "b", by_card_type: { LEAD: { dial_clicks: 0, genuine_score: null }, DATA: { dial_clicks: 9, genuine_score: 61 } } },
  { employee_id: "c", by_card_type: { LEAD: { dial_clicks: 2, genuine_score: null } } }
] }).entries()], [["a", "Green"], ["b", "Amber"], ["c", null]]);
// Workload overdue = LeadCard's badge: reference copy of components/LeadCard.tsx (lines 137-156) on LeadList's card fields.
const { calculateSLAStatus } = require(path.join(root, "lib/calculateSLAStatus.ts"));
const refOverdue = (l, h) => {
  const card = { status: l.status, board_stage: l.board_stage, sla_deadline: l.sla_deadline, recycle_count: l.recycle_count, outcome_at: h.outcome_at ?? null, assigned_at: h.assigned_at ?? null, last_activity_at: h.last_activity_at ?? null, paused_until: h.paused_until ?? null, pause_reason: h.pause_reason ?? null, is_personal_lead: l.is_personal_lead ?? false };
  const s = calculateSLAStatus({ status: card.status, sla_deadline: card.sla_deadline, recycle_count: card.recycle_count, board_stage: card.board_stage, paused_until: card.paused_until, last_activity_at: card.last_activity_at, pause_reason: card.pause_reason, assigned_at: card.assigned_at }, card.outcome_at, 0, false, card.is_personal_lead, calTue);
  return s === "FOLLOWUP_INACTIVITY_WARNING" || s === "FOLLOWUP_INACTIVITY_RECYCLE_READY";
};
const dayAgo = (d) => new Date(Date.now() - d * 86400e3).toISOString();
const wl = [];
for (const [i, [stage, status, days, pause]] of [["FOLLOW_UP", "CONNECTED", 4, null], ["FOLLOW_UP", "CONNECTED", 1, null], ["FOLLOW_UP", "CONNECTED", 8, null], ["LEADS", "NEW", 0, null], ["FOLLOW_UP", "CONNECTED", 9, "SNOOZE"], ["VISIT", "CONNECTED", 10, null]].entries()) {
  wl.push({ current_owner_id: "o1", status, board_stage: stage, sla_deadline: null, recycle_count: 0, is_personal_lead: false, lead_history: [
    { employee_id: "x", is_active: false, call_count: 1, outcome_at: dayAgo(30), assigned_at: dayAgo(40), first_call_at: dayAgo(30), first_whatsapp_at: null, last_activity_at: dayAgo(30), paused_until: null, pause_reason: null },
    { employee_id: "o1", is_active: true, call_count: status === "NEW" ? 0 : 1, outcome_at: status === "NEW" ? null : dayAgo(days), assigned_at: dayAgo(days + 1), first_call_at: status === "NEW" ? null : dayAgo(days), first_whatsapp_at: null, last_activity_at: status === "NEW" ? dayAgo(days + 1) : dayAgo(days), paused_until: pause ? new Date(Date.now() + 86400e3).toISOString() : null, pause_reason: pause }
  ] });
}
const refCount = wl.filter((l) => refOverdue(l, l.lead_history[1])).length;
const got = ah.workloadByOwner(wl, calTue).get("o1");
eq("workload: overdue = LeadCard badge, own active assignment only", [got.overdue, got.leads, got.untouched], [refCount, 6, 1]);

const todayHook = read("lib/useAdminToday.ts");
const rpcs = todayHook.match(/\.rpc\("([a-z_]+)"/g) || [];
if (rpcs.length !== 1 || !todayHook.includes('rpc("get_call_quality_summary", { p_employee_id: null,')) problems.push("useAdminToday: the only RPC is get_call_quality_summary (all employees, display only)");
if (/setInterval\(|\.channel\(|\.(insert|update|upsert|delete)\(/.test(todayHook)) problems.push("useAdminToday: read-only, no polling, no channel");
const fromTodayCalls = (todayHook.match(/\.from\(/g) || []).length;
const boundedToday = (todayHook.match(/\.limit\(/g) || []).length + (todayHook.match(/fetchAllRows\(/g) || []).length;
if (boundedToday < fromTodayCalls) problems.push(`useAdminToday: every read bounded (${fromTodayCalls} reads, ${boundedToday} bounds)`);
const loadAllBody = todayHook.slice(todayHook.indexOf("const loadAll = useCallback"), todayHook.indexOf("}, [loadTiles, loadTeam]);"));
if (loadAllBody.includes("loadWorkload")) problems.push("useAdminToday: workload never loads on the first load or on Refresh, only when asked");
const cards = read("components/AdminTodayCards.tsx");
if (!cards.includes("onClick={today.loadWorkload}")) problems.push("Team today: workload behind the Show workload button");
if (/purple|violet|fuchsia|opacity-80/i.test(cards)) problems.push("AdminTodayCards: no purple, no faded labels");

// 7) A3 (2026-11-19): Lead engine today + positive-history junk.
eq("guard groups (today, with yesterday), most frequent first", ah.groupGuardEvents(
  [{ source: "db_positive_junk_guard", action: "JUNK_REFUSED" }, { source: "db_positive_junk_guard", action: "JUNK_REFUSED" }, { source: "reminder_hold", action: "REMINDER_HOLD" }, { source: "new_thing", action: "SOME_ACTION" }],
  [{ source: "db_positive_junk_guard", action: "JUNK_REFUSED" }, { source: "admin_reassign", action: "ADMIN_REASSIGN" }]
), [
  { key: "db_positive_junk_guard/JUNK_REFUSED", label: "Junk refused (positive history)", today: 2, yesterday: 1 },
  { key: "new_thing/SOME_ACTION", label: "new thing/some action", today: 1, yesterday: 0 },
  { key: "reminder_hold/REMINDER_HOLD", label: "Reminder hold", today: 1, yesterday: 0 }
]);
const P = (until, restored, undone = null) => ({ protected_until: until, restored_at: restored, undone_at: undone });
const NOWP = Date.parse("2026-11-19T10:00:00Z");
const prot = [P("2026-12-02T08:47:00Z", "2026-11-18T08:47:00Z"), P("2026-11-25T00:00:00Z", "2026-11-19T09:00:00Z"), P("2026-11-30T00:00:00Z", "2026-11-10T00:00:00Z", "2026-11-19T08:00:00Z"), P("2026-11-19T05:00:00Z", "2026-11-05T00:00:00Z")];
eq("protections open now", ah.openProtections(prot, NOWP), { count: 2, earliestEnd: "2026-11-25T00:00:00Z" });
eq("protections open 24 h ago", ah.openProtections(prot, NOWP - 86400e3).count, 3);
// Positive-history junk = the page's "All" (app/admin/positive-junk: data.rows.length), from the same RPC.
const pjData = { rows: [{ lead_id: "a" }, { lead_id: "b" }, { lead_id: "c" }], employees: [] };
eq("positive junk count = page's All", ah.positiveJunkCount(pjData), pjData.rows.length);
eq("positive junk: nothing / bad answer = 0", [ah.positiveJunkCount(null), ah.positiveJunkCount({})], [0, 0]);
eq("positive junk row: amber, hidden at 0 and before the check", [
  ah.needsActionRows({ positiveJunk: 3 }).map((r) => `${r.key}:${r.severity}:${r.href}`),
  ah.needsActionRows({ positiveJunk: 0 }).length,
  ah.needsActionRows({ positiveJunk: null }).length
], [["positive-junk:warning:/admin/positive-junk"], 0, 0]);

const eng = read("lib/useAdminEngine.ts");
const engRpcs = eng.match(/\.rpc\("([a-z_]+)"/g) || [];
if (engRpcs.length !== 2 || !eng.includes('rpc("get_positive_junk_leads")') || !eng.includes('rpc("get_admin_guard_event_counts"')) problems.push("useAdminEngine: RPCs are get_positive_junk_leads (Check) and get_admin_guard_event_counts (load) only");
if (/from("lead_guard_events")/.test(eng)) problems.push("useAdminEngine: lead_guard_events has no client grant; read it only through get_admin_guard_event_counts");
const loadEngineBody = eng.slice(eng.indexOf("const loadEngine = useCallback"), eng.indexOf("const checkPositiveJunk = useCallback"));
const refreshBody = eng.slice(eng.indexOf("const refresh = useCallback"), eng.indexOf("return { engine, pj"));
if (loadEngineBody.includes('rpc("get_positive_junk_leads")') || refreshBody.includes("checkPositiveJunk")) problems.push("useAdminEngine: positive junk only on Check, never on load / Refresh");
if (/setInterval\(|\.channel\(|\.(insert|update|upsert|delete)\(/.test(eng)) problems.push("useAdminEngine: read-only, no polling, no channel");
const engFrom = (eng.match(/\.from\(/g) || []).length;
const engLimit = (eng.match(/\.limit\(/g) || []).length;
if (engLimit < engFrom) problems.push(`useAdminEngine: every read bounded (${engFrom} reads, ${engLimit} limits)`);
const engCard = read("components/AdminEngineCard.tsx");
if (!engCard.includes("onClick={engine.checkPositiveJunk}")) problems.push("Lead engine card: positive junk behind Check");
if (/purple|violet|fuchsia|opacity-80/i.test(engCard)) problems.push("AdminEngineCard: no purple, no faded labels");

// 8) A4 (2026-11-20): Visits and bookings, System controls, junk today.
// Live 19 Nov: each admin got 27 LEAD_JUNKED notifications, admin_junk 0, 27 leads went JUNK that day -> sweep 27.
eq("junk today: 19 Nov known answer", ah.junkToday(27, 0), { sweep: 27, admin: 0 });
eq("junk today: admin junk is taken out of the sweep count", ah.junkToday(30, 3), { sweep: 27, admin: 3 });
eq("junk today: never below 0", ah.junkToday(1, 4), { sweep: 0, admin: 4 });
eq("month start (IST), 20 Nov 10:00 IST", ah.istMonthStartIso(Date.parse("2026-11-20T10:00:00+05:30")), "2026-10-31T18:30:00.000Z");
eq("month start (IST), 1 Dec 02:00 IST is December", ah.istMonthStartIso(Date.parse("2026-12-01T02:00:00+05:30")), "2026-11-30T18:30:00.000Z");
eq("month windows on the 1st: yesterday's share is empty", ah.monthWindows(Date.parse("2026-12-01T10:00:00+05:30")).yesterday, { from: "2026-11-30T18:30:00.000Z", to: "2026-11-30T18:30:00.000Z" });
eq("month windows mid-month", ah.monthWindows(Date.parse("2026-11-20T10:00:00+05:30")), {
  now: { from: "2026-10-31T18:30:00.000Z", to: "2026-11-20T04:30:00.000Z" },
  yesterday: { from: "2026-10-31T18:30:00.000Z", to: "2026-11-19T04:30:00.000Z" }
});
// The live lead_engine_settings row of 20 Nov (only the switch columns), before the Home flag SQL.
const live20 = { auto_junk_enabled: true, auto_recycle_enabled: true, positive_junk_guard_mode: "enforce", restore_hold_mode: "enforce", reminder_hold_mode: "shadow",
  recycle_sibling_guard_mode: "shadow", given_lead_context_mode: "on", given_lead_context_pilot_ids: [], call_quality_enforced: false };
eq("controls: live 20 Nov row", ah.controlStates(live20).map((r) => `${r.key}=${r.state}${r.pilots === null ? "" : `/${r.pilots}`}`), [
  "auto_recycle_enabled=ON", "auto_junk_enabled=ON", "positive_junk_guard_mode=ENFORCE", "restore_hold_mode=ENFORCE", "reminder_hold_mode=SHADOW",
  "recycle_sibling_guard_mode=SHADOW", "given_lead_context_mode=ON/0", "call_quality_enforced=OFF", "employee_home_mode=NOT_SET", "admin_home_mode=NOT_SET"
]);
eq("controls: pilot, admin_pilot, unknown, null", ah.controlStates({ employee_home_mode: "admin_pilot", employee_home_pilot_ids: ["a", "b"], admin_home_mode: "weird", auto_junk_enabled: null })
  .filter((r) => ["employee_home_mode", "admin_home_mode", "auto_junk_enabled"].includes(r.key)).map((r) => `${r.key}=${r.state}${r.pilots === null ? "" : `/${r.pilots}`}`),
  ["auto_junk_enabled=NOT_SET", "employee_home_mode=PILOT/2", "admin_home_mode=UNKNOWN"]);

const sales = read("lib/useAdminSales.ts");
if (/\.rpc\(|setInterval\(|\.channel\(|\.(insert|update|upsert|delete)\(/.test(sales)) problems.push("useAdminSales: read-only, no RPC, no polling, no channel");
if ((sales.match(/\.from\(/g) || []).length !== 2 || !sales.includes('.eq("id", 1).maybeSingle()') || !sales.includes("head: true")) problems.push("useAdminSales: one settings row + count-only reads");
const engA4 = read("lib/useAdminEngine.ts");
if (!engA4.includes('.eq("type", "LEAD_JUNKED")') || !engA4.includes('.eq("employee_id", employeeId)') || !engA4.includes("adminJunkCount(gt.data") || !engA4.includes("adminJunkCount(gy.data")) problems.push("useAdminEngine: junk today = own LEAD_JUNKED notifications + admin_junk guard counts");
const salesCard = read("components/AdminSalesCards.tsx");
if (/onChange=|<input|<select|purple|violet|fuchsia|opacity-80/i.test(salesCard)) problems.push("AdminSalesCards: display only (no switches), no purple, no faded labels");

// 9) A5 (2026-11-20): one look for every card (design.md "Look"), Needs action announced, no off-scale type.
const homeFiles = ["components/AdminHomeA1.tsx", "components/AdminTodayCards.tsx", "components/AdminEngineCard.tsx", "components/AdminSalesCards.tsx"];
for (const f of homeFiles) {
  const src = read(f);
  if (!src.includes('from "@/components/AdminHomeUi"')) problems.push(`${f}: uses the shared Home building blocks`);
  if (/\btext-(xs|sm|lg|xl)\b|text-\[(?!13px|15px|22px|28px)[0-9]+px\]/.test(src)) problems.push(`${f}: type scale is 22 / 16 / 28 / 15 / 13 only`);
  if (/^(const CARD|function FadeIn|const Skeleton|function Skeleton|const Retry|function Retry)/m.test(src)) problems.push(`${f}: no private copy of a shared block`);
  if (/text-(red|emerald)-700"? ?:? ?.*d\.dir/.test(src)) problems.push(`${f}: deltas are neutral (red only for act now)`);
}
const shell = read("components/AdminHomeA1.tsx");
if (!shell.includes('aria-live="polite"')) problems.push("Needs action: aria-live");
if (!shell.includes("aria-busy={busy}")) problems.push("Refresh: busy state");

// 2026-11-28 engine RPC: count helpers (known answers) and the SQL draft shape.
{
  const rows = [{ source: "admin_junk", action: "JUNK", n: "3" }, { source: "owner_leave", action: "OWNER_ON_LEAVE", n: 2 }];
  const g = ah.groupGuardCounts(rows, [{ source: "owner_leave", action: "OWNER_ON_LEAVE", n: 5 }]);
  if (JSON.stringify(g.map((x) => [x.key, x.today, x.yesterday])) !== JSON.stringify([["admin_junk/JUNK", 3, 0], ["owner_leave/OWNER_ON_LEAVE", 2, 5]])) problems.push("groupGuardCounts: counts per source/action, today first");
  if (ah.adminJunkCount(rows) !== 3 || ah.adminJunkCount(null) !== 0) problems.push("adminJunkCount: sums admin_junk only");
  const sql = read("supabase/sql/2026-11-28_admin_guard_event_counts.sql");
  for (const need of ["security definer", "set search_path = public", "public.is_admin()", "errcode = '42501'", "interval '3 days'", "from public;", "from anon;", "to authenticated;"])
    if (!sql.includes(need)) problems.push("guard counts SQL draft: missing " + need);
  if (/grant[^;]*ons+(tables+)?public.lead_guard_events|alters+tables+public.lead_guard_events|policy/i.test(sql.replace(/^--.*$/gm, ""))) problems.push("guard counts SQL draft: lead_guard_events grants / policies must not change");
}

if (problems.length) {
  console.error("check-admin-home FAILED:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("check-admin-home: OK");

