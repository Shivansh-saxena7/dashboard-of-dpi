#!/usr/bin/env node
// Known-answer check for lib/workingCalendar.ts (run in prebuild). The
// answers are the same ones the DB functions working_add /
// working_elapsed passed in their rollback test on 2026-10-07, so the TS
// and SQL implementations can't silently drift apart. No DB access —
// scripts/check-working-calendar-parity.mjs does the live comparison.
//
// The TS file is transpiled with the project's own `typescript` package
// so this runs on any Node version (no type-stripping flag needed).

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

// Loads a lib/*.ts file (and its relative ./*.ts imports) as CommonJS.
const loaded = {};
function loadLib(file) {
  if (loaded[file]) return loaded[file];
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", file), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  });
  const mod = { exports: {} };
  loaded[file] = mod.exports;
  const requireLib = (p) => loadLib(path.basename(p).replace(/(.ts)?$/, ".ts"));
  new Function("module", "exports", "require", outputText)(mod, mod.exports, requireLib);
  return mod.exports;
}
const { workingAdd, workingElapsedMs, nonWorkingStatusAt, loadJobWorkingCalendar, isNotificationWindowOpen, timerMsUntil, timersPausedDisplay, formatPauseUntil, shiftStartBlock, DAY_MS } = loadLib("workingCalendar.ts");
const { calculateSLAStatus, getRecycleCutoff } = loadLib("calculateSLAStatus.ts");
const { recyclingTomorrowCutoff } = loadLib("recyclingTomorrow.ts");
const { isWithinRecycleHours } = loadLib("recycleHours.ts");
const { normalizeLegacyMobile, isHeaderlessFirstRow, guessLegacyColumn, isLegacyVisitDone, guessLegacyMobileColumnByContent, cleanLegacyText } = loadLib("legacyNumbers.ts");
const legacyText = (v) => { const r = cleanLegacyText(v); return `${r.rejected ? "rejected" : "ok"}:${r.text ?? ""}`; };
const legacy = (raw) => { const r = normalizeLegacyMobile(raw); return `${r.kind}:${r.numbers.join("+")}`; };

const HOUR = 60 * 60 * 1000;
const ist = (s) => new Date(`${s}+05:30`).getTime();
const range = (from, to, kind, reason) => ({ id: null, startsAt: ist(from), endsAt: ist(to), kind, reason });

const tuesdayOff = { weeklyOffDay: 2, ranges: [], timersEnabled: true };
const holiday = range("2026-10-14T00:00", "2026-10-15T00:00", "HOLIDAY", "TEST holiday");
const pause = range("2026-10-16T12:00", "2026-10-16T18:00", "TIMER_PAUSE", "TEST pause");
const withHoliday = { weeklyOffDay: 2, ranges: [holiday] };
const withBoth = { weeklyOffDay: 2, ranges: [holiday, pause] };
const wednesdayOff = { weeklyOffDay: 3, ranges: [] };
const now = Date.now();

// Step 4 (2026-10-07): calculateSLAStatus / getRecycleCutoff with the
// working calendar. Switch OFF (or no calendar) must equal the old
// calendar-day behaviour; ON counts working time for the Follow-up
// inactivity clock only (cooldowns stay calendar until Step 5).
const switchOff = { ...tuesdayOff, timersEnabled: false };
const holidayOn = { ...withHoliday, timersEnabled: true };
const followup = (lastActivity) => ({
  status: "CONNECTED", board_stage: "FOLLOW_UP", lead_type: "LEAD", recycle_count: 0, sla_deadline: null,
  paused_until: null, pause_reason: null, assigned_at: new Date(lastActivity - DAY_MS).toISOString(),
  last_activity_at: new Date(lastActivity).toISOString()
});
const cooldown = {
  status: "NOT_INTERESTED", board_stage: "LEADS", lead_type: "LEAD", recycle_count: 0, sla_deadline: null,
  paused_until: null, pause_reason: null, assigned_at: "2026-10-12T10:00:00+05:30", last_activity_at: "2026-10-12T10:00:00+05:30"
};
const cutoffMs = (lead, cal, outcomeAt = null) => getRecycleCutoff(lead, outcomeAt, false, cal)?.cutoffAt.getTime() ?? null;
const monAct = ist("2026-10-12T17:00");
// Deterministic "now"-relative calendars: no weekly off, one non-working day.
const dayOffAgo = (fromDays, toDays) => ({ weeklyOffDay: null, timersEnabled: true, ranges: [{ id: null, startsAt: now - fromDays * DAY_MS, endsAt: now - toDays * DAY_MS, kind: "HOLIDAY", reason: "TEST" }] });
const sla = (lead, cal, onLeave = false) => calculateSLAStatus(lead, null, 0, onLeave, false, cal);

const cases = [
  ["T1 Mon 17:00 + 3 working days", workingAdd(tuesdayOff, ist("2026-10-12T17:00"), 3 * DAY_MS).getTime(), ist("2026-10-16T17:00")],
  ["T2 Tue (off) 10:00 + 1 day", workingAdd(tuesdayOff, ist("2026-10-13T10:00"), DAY_MS).getTime(), ist("2026-10-15T00:00")],
  ["T3 Sun 12:00 + 6 days", workingAdd(tuesdayOff, ist("2026-10-11T12:00"), 6 * DAY_MS).getTime(), ist("2026-10-18T12:00")],
  ["T4 elapsed Mon 17:00 -> Fri 17:00", workingElapsedMs(tuesdayOff, ist("2026-10-12T17:00"), ist("2026-10-16T17:00")), 72 * HOUR],
  ["T5 elapsed over Tuesday only", workingElapsedMs(tuesdayOff, ist("2026-10-13T00:00"), ist("2026-10-14T00:00")), 0],
  ["T6 holiday Wed: Mon 17:00 + 3", workingAdd(withHoliday, ist("2026-10-12T17:00"), 3 * DAY_MS).getTime(), ist("2026-10-17T17:00")],
  ["T7 holiday: elapsed Mon 17:00 -> Sat 17:00", workingElapsedMs(withHoliday, ist("2026-10-12T17:00"), ist("2026-10-17T17:00")), 72 * HOUR],
  ["T9 + 6h pause Fri: Mon 17:00 + 3", workingAdd(withBoth, ist("2026-10-12T17:00"), 3 * DAY_MS).getTime(), ist("2026-10-17T23:00")],
  ["T11 round trip now + 6 days", workingElapsedMs(tuesdayOff, now, workingAdd(tuesdayOff, now, 6 * DAY_MS)), 6 * DAY_MS],
  ["T12 weekly off Wed: Tue 10:00 + 1", workingAdd(wednesdayOff, ist("2026-10-13T10:00"), DAY_MS).getTime(), ist("2026-10-15T10:00")],
  ["Zero amount returns start", workingAdd(tuesdayOff, ist("2026-10-13T10:00"), 0).getTime(), ist("2026-10-13T10:00")],
  ["Status: Tue = weekly off until Wed 00:00", (() => { const s = nonWorkingStatusAt(tuesdayOff, ist("2026-10-13T10:00")); return s.isNonWorking && s.kind === "WEEKLY_OFF" ? s.until.getTime() : -1; })(), ist("2026-10-14T00:00")],
  ["Status: Tue off + Wed holiday chain until Thu 00:00", (() => { const s = nonWorkingStatusAt(withHoliday, ist("2026-10-13T10:00")); return s.isNonWorking ? s.until.getTime() : -1; })(), ist("2026-10-15T00:00")],
  ["Status: inside pause = TIMER_PAUSE until Fri 18:00", (() => { const s = nonWorkingStatusAt(withBoth, ist("2026-10-16T13:00")); return s.isNonWorking && s.kind === "TIMER_PAUSE" ? s.until.getTime() : -1; })(), ist("2026-10-16T18:00")],
  ["Status: Mon working", nonWorkingStatusAt(tuesdayOff, ist("2026-10-12T10:00")).isNonWorking ? 1 : 0, 0],
  ["S1 cutoff, no calendar: Mon 17:00 + 6 calendar days", cutoffMs(followup(monAct), null), ist("2026-10-18T17:00")],
  ["S2 cutoff, switch OFF = same as no calendar", cutoffMs(followup(monAct), switchOff), ist("2026-10-18T17:00")],
  ["S3 cutoff, switch ON: + 6 working days", cutoffMs(followup(monAct), tuesdayOff), ist("2026-10-19T17:00")],
  ["S4 cutoff, ON + holiday Wed 14", cutoffMs(followup(monAct), holidayOn), ist("2026-10-21T17:00")],
  // Step 5 (2026-10-08): cooldowns on the working calendar.
  ["S5 NOT_INTERESTED 7d, ON: lands past two Tuesdays", cutoffMs(cooldown, tuesdayOff, "2026-10-12T17:00:00+05:30"), ist("2026-10-21T17:00")],
  ["C0 NOT_INTERESTED 7d, OFF = old calendar answer", cutoffMs(cooldown, switchOff, "2026-10-12T17:00:00+05:30"), ist("2026-10-19T17:00")],
  ["C1 NOT_CONNECTED 3d, ON: Mon 17:00 skips Tue", cutoffMs({ ...cooldown, status: "NOT_CONNECTED" }, tuesdayOff, "2026-10-12T17:00:00+05:30"), ist("2026-10-16T17:00")],
  ["C1b NOT_CONNECTED 3d, OFF = Thu 17:00", cutoffMs({ ...cooldown, status: "NOT_CONNECTED" }, switchOff, "2026-10-12T17:00:00+05:30"), ist("2026-10-15T17:00")],
  ["C2 NOT_CONNECTED logged after hours Mon 21:30, ON", cutoffMs({ ...cooldown, status: "NOT_CONNECTED" }, tuesdayOff, "2026-10-12T21:30:00+05:30"), ist("2026-10-16T21:30")],
  ["C3 NOT_CONNECTED 3d, ON + Wed holiday", cutoffMs({ ...cooldown, status: "NOT_CONNECTED" }, holidayOn, "2026-10-12T17:00:00+05:30"), ist("2026-10-17T17:00")],
  ["C4 SWITCHED_OFF logged on Tuesday 10:00, ON: clock starts Wed", cutoffMs({ ...cooldown, status: "SWITCHED_OFF" }, tuesdayOff, "2026-10-13T10:00:00+05:30"), ist("2026-10-17T00:00")],
  ["C5 cooldown status 3.5d incl. 1 non-working day, ON = COOLDOWN", calculateSLAStatus({ ...cooldown, status: "NOT_CONNECTED" }, new Date(now - 3.5 * DAY_MS).toISOString(), 0, false, false, dayOffAgo(3, 2)), "COOLDOWN"],
  ["C6 same, OFF = RECYCLE_READY (old behaviour)", calculateSLAStatus({ ...cooldown, status: "NOT_CONNECTED" }, new Date(now - 3.5 * DAY_MS).toISOString(), 0, false, false, { ...dayOffAgo(3, 2), timersEnabled: false }), "RECYCLE_READY"],
  ["C7 DATA NOT_CONNECTED still has no cutoff", cutoffMs({ ...cooldown, status: "NOT_CONNECTED", lead_type: "DATA" }, tuesdayOff, "2026-10-12T17:00:00+05:30"), null],
  ["S6 DATA lead: no cutoff", cutoffMs({ ...followup(monAct), lead_type: "DATA", status: "NOT_CONNECTED" }, tuesdayOff), null],
  ["S7 status 6.5d idle, OFF = recycle-ready", sla(followup(now - 6.5 * DAY_MS), { ...dayOffAgo(5, 4), timersEnabled: false }), "FOLLOWUP_INACTIVITY_RECYCLE_READY"],
  ["S8 status 6.5d idle incl. 1 non-working day, ON = warning", sla(followup(now - 6.5 * DAY_MS), dayOffAgo(5, 4)), "FOLLOWUP_INACTIVITY_WARNING"],
  ["S9 status 3.5d idle, OFF = warning", sla(followup(now - 3.5 * DAY_MS), null), "FOLLOWUP_INACTIVITY_WARNING"],
  ["S10 status 3.5d idle incl. 1 non-working day, ON = within window", sla(followup(now - 3.5 * DAY_MS), dayOffAgo(3, 2)), "FOLLOWUP_WITHIN_WINDOW"],
  ["S11 owner on leave still wins when ON", sla(followup(now - 10 * DAY_MS), dayOffAgo(3, 2), true), "FOLLOWUP_WITHIN_WINDOW"],
  ["S12 paused lead still PAUSED when ON", sla({ ...followup(now - 10 * DAY_MS), paused_until: new Date(now + DAY_MS).toISOString() }, tuesdayOff), "PAUSED"],
  ["S13 Recycling Tomorrow, OFF: due in 12h = flagged", recyclingTomorrowCutoff(followup(now - 5.5 * DAY_MS), null, 0, false, now, { ...dayOffAgo(5, 4), timersEnabled: false }) !== null, true],
  ["S14 Recycling Tomorrow, ON: due in 36h = not flagged", recyclingTomorrowCutoff(followup(now - 5.5 * DAY_MS), null, 0, false, now, dayOffAgo(5, 4)) !== null, false]
];

// Background-job calendar load with a mocked failing RPC (2026-10-07):
// switch OFF = carry on with null calendar + one warning; switch ON or
// unreadable switch = skip timer work, no fallback.
async function jobLoad({ rpc, switchOn }) {
  const warnings = [];
  const supabaseMock = { rpc: async () => rpc() };
  const result = await loadJobWorkingCalendar(
    supabaseMock,
    async () => { if (switchOn === "throws") throw new Error("settings read failed"); return switchOn; },
    async (message) => { warnings.push(message); }
  );
  return `calendar=${result.calendar ? "loaded" : "null"} skip=${result.skipTimerWork} warnings=${warnings.length}`;
}
const rpcOk = () => ({ data: { weekly_off_day: 2, timers_enabled: false, ranges: [] }, error: null });
const rpcError = () => ({ data: null, error: { message: "mock: get_working_calendar failed" } });
const rpcThrows = () => { throw new Error("mock: network down"); };

async function main() {
  cases.push(
    ["F1 RPC ok", await jobLoad({ rpc: rpcOk, switchOn: false }), "calendar=loaded skip=false warnings=0"],
    ["F2 RPC error + switch OFF = continue on calendar time + warning", await jobLoad({ rpc: rpcError, switchOn: false }), "calendar=null skip=false warnings=1"],
    ["F3 RPC throws + switch OFF = continue + warning", await jobLoad({ rpc: rpcThrows, switchOn: false }), "calendar=null skip=false warnings=1"],
    ["F4 RPC error + switch ON = skip run", await jobLoad({ rpc: rpcError, switchOn: true }), "calendar=null skip=true warnings=0"],
    ["F5 RPC throws + switch ON = skip run", await jobLoad({ rpc: rpcThrows, switchOn: true }), "calendar=null skip=true warnings=0"],
    ["F6 RPC error + switch unreadable = skip run (safe side)", await jobLoad({ rpc: rpcError, switchOn: "throws" }), "calendar=null skip=true warnings=0"],
    ["F7 OFF fallback (null calendar) = old calendar-day cutoff", cutoffMs(followup(monAct), null), ist("2026-10-18T17:00")]
  );

  // Step 6 (2026-10-07): notification window, working-day "tomorrow",
  // working-day pause-expiry heads-up. OFF must equal the old behaviour.
  const bothOn = { ...withBoth, timersEnabled: true };
  const wedAct = ist("2026-10-07T12:00");
  const tomorrow = (nowMs, cal) => recyclingTomorrowCutoff(followup(wedAct), null, 0, false, nowMs, cal)?.getTime() ?? null;
  cases.push(
    ["W1 window ON, Mon 10:00 = open", isNotificationWindowOpen(tuesdayOff, ist("2026-10-12T10:00")), true],
    ["W2 window ON, Mon 08:30 = held", isNotificationWindowOpen(tuesdayOff, ist("2026-10-12T08:30")), false],
    ["W3 window ON, Mon 20:30 = held", isNotificationWindowOpen(tuesdayOff, ist("2026-10-12T20:30")), false],
    ["W4 window ON, Tue (weekly off) 10:00 = held", isNotificationWindowOpen(tuesdayOff, ist("2026-10-13T10:00")), false],
    ["W5 window ON, inside Admin pause Fri 13:00 = held", isNotificationWindowOpen(bothOn, ist("2026-10-16T13:00")), false],
    ["W6 window ON, Fri 19:00 after pause = open", isNotificationWindowOpen(bothOn, ist("2026-10-16T19:00")), true],
    ["W7 window OFF, Tue 10:00 = open (old behaviour)", isNotificationWindowOpen(switchOff, ist("2026-10-13T10:00")), true],
    ["W8 window, no calendar, 02:00 = open (old behaviour)", isNotificationWindowOpen(null, ist("2026-10-13T02:00")), true],
    ["R1 Recycling Tomorrow ON, Mon 18:00: due Wed 12:00 (18 working h) = flagged", tomorrow(ist("2026-10-12T18:00"), tuesdayOff), ist("2026-10-14T12:00")],
    ["R2 Recycling Tomorrow OFF, Mon 18:00: old cutoff Tue 12:00 = flagged", tomorrow(ist("2026-10-12T18:00"), switchOff), ist("2026-10-13T12:00")],
    ["R3 Recycling Tomorrow ON, Mon 10:00: 26 working h left = not flagged", tomorrow(ist("2026-10-12T10:00"), tuesdayOff), null],
    ["P1 pause ends Fri 12:00, now Mon 12:00, ON = 72 working h (warn)", timerMsUntil(tuesdayOff, ist("2026-10-16T12:00"), ist("2026-10-12T12:00")), 72 * HOUR],
    ["P2 same, OFF = 96h (no warn yet, old behaviour)", timerMsUntil(switchOff, ist("2026-10-16T12:00"), ist("2026-10-12T12:00")), 96 * HOUR],
    ["P3 already passed stays negative", timerMsUntil(tuesdayOff, ist("2026-10-12T11:00"), ist("2026-10-12T12:00")), -HOUR],
    ["B1 banner ON, Tue: weekly off, till end of Tue", (() => { const d = timersPausedDisplay(tuesdayOff, ist("2026-10-13T10:00")); return d ? `${d.kind} | ${d.untilLabel}` : null; })(), "WEEKLY_OFF | end of Tue, 13 Oct"],
    ["B2 banner ON, inside Admin pause Fri 13:00", (() => { const d = timersPausedDisplay(bothOn, ist("2026-10-16T13:00")); return d ? `${d.kind} | ${d.reason} | ${d.untilLabel}` : null; })(), "TIMER_PAUSE | TEST pause | Fri, 16 Oct, 6:00 pm"],
    ["B3 banner ON, Tue + Wed holiday chain: till end of Wed", (() => { const d = timersPausedDisplay(holidayOn, ist("2026-10-13T10:00")); return d ? d.untilLabel : null; })(), "end of Wed, 14 Oct"],
    ["B4 banner ON, Mon working = nothing", timersPausedDisplay(tuesdayOff, ist("2026-10-12T10:00")), null],
    ["B5 banner OFF, Tue = nothing (old behaviour)", timersPausedDisplay(switchOff, ist("2026-10-13T10:00")), null],
    ["B6 holiday ending at midnight reads as end of last day", formatPauseUntil(ist("2026-10-15T00:00")), "end of Wed, 14 Oct"],
    // Weekly-off Start Shift gate (2026-10-08).
    ["G1 Tue 10:45, switch ON = blocked (weekly off)", (() => { const g = shiftStartBlock(tuesdayOff, ist("2026-10-13T10:45"), { hasOverride: false }); return g.blocked ? g.kind : "allowed"; })(), "WEEKLY_OFF"],
    ["G2 Mon 10:45, switch ON = allowed", shiftStartBlock(tuesdayOff, ist("2026-10-12T10:45"), { hasOverride: false }).blocked, false],
    ["G3 Tue, switch OFF = allowed (old behaviour)", shiftStartBlock(switchOff, ist("2026-10-13T10:45"), { hasOverride: false }).blocked, false],
    ["G4 Tue, Admin override = allowed", shiftStartBlock(tuesdayOff, ist("2026-10-13T10:45"), { hasOverride: true }).blocked, false],
    ["G5 Admin TIMER_PAUSE (Fri 13:00) = allowed, only timers pause", shiftStartBlock(bothOn, ist("2026-10-16T13:00"), { hasOverride: false }).blocked, false],
    ["G6 Admin HOLIDAY Wed = blocked", (() => { const g = shiftStartBlock(holidayOn, ist("2026-10-14T10:45"), { hasOverride: false }); return g.blocked ? g.kind : "allowed"; })(), "HOLIDAY"],
    ["G7 no calendar (load failed / fail-open path) = allowed", shiftStartBlock(null, ist("2026-10-13T10:45"), { hasOverride: false }).blocked, false],
    ["G9 Admin HOLIDAY + override = allowed", shiftStartBlock(holidayOn, ist("2026-10-14T10:45"), { hasOverride: true }).blocked, false],
    ["G10 holiday message names the reason", (() => { const g = shiftStartBlock(holidayOn, ist("2026-10-14T10:45"), { hasOverride: false }); return g.blocked ? g.message : ""; })(), "Aaj TEST holiday ki wajah se non-working day hai (till end of Wed, 14 Oct) — shift start nahi ho sakti."],
    ["G8 weekly-off message", (() => { const g = shiftStartBlock(tuesdayOff, ist("2026-10-13T10:45"), { hasOverride: false }); return g.blocked ? g.message : ""; })(), "Aaj weekly off hai — shift start nahi ho sakti. Special working day ke liye Admin se override lein."],
    // Recycle hours (Option A Phase 1): 10:30 (first_half_start_time) to
    // 18:30 (sla_office_end_time) + grace, read from settings.
    ["H1 Thu 14:00 = recycles allowed", isWithinRecycleHours(ist("2026-10-08T14:00"), "10:30:00", "18:30:00", 0), true],
    ["H2 Thu 10:30 exactly = allowed (first shift window opens)", isWithinRecycleHours(ist("2026-10-08T10:30"), "10:30:00", "18:30:00", 0), true],
    ["H3 Thu 18:29 = allowed", isWithinRecycleHours(ist("2026-10-08T18:29"), "10:30:00", "18:30:00", 0), true],
    ["H4 Thu 18:30 = none (office closed)", isWithinRecycleHours(ist("2026-10-08T18:30"), "10:30:00", "18:30:00", 0), false],
    ["H5 Thu 22:00 = none", isWithinRecycleHours(ist("2026-10-08T22:00"), "10:30:00", "18:30:00", 0), false],
    ["H6 Fri 00:30 (yesterday's open shift still counts by UTC date) = none", isWithinRecycleHours(ist("2026-10-09T00:30"), "10:30:00", "18:30:00", 0), false],
    ["H7 Fri 05:15 = none", isWithinRecycleHours(ist("2026-10-09T05:15"), "10:30:00", "18:30:00", 0), false],
    ["H8 Fri 10:15 = none (before any shift can start)", isWithinRecycleHours(ist("2026-10-09T10:15"), "10:30:00", "18:30:00", 0), false],
    ["H9 grace 30 min: 18:45 = allowed", isWithinRecycleHours(ist("2026-10-08T18:45"), "10:30:00", "18:30:00", 30), true],
    ["H10 grace 30 min: 19:00 = none", isWithinRecycleHours(ist("2026-10-08T19:00"), "10:30:00", "18:30:00", 30), false],
    ["H11 Admin moves office end to 19:30: 19:00 = allowed", isWithinRecycleHours(ist("2026-10-08T19:00"), "10:30:00", "19:30:00", 0), true],
    ["H12 Admin moves day start to 09:30: 10:00 = allowed", isWithinRecycleHours(ist("2026-10-08T10:00"), "09:30:00", "18:30:00", 0), true],
    // Legacy numbers register (2026-10-08) — FAKE numbers only.
    ["N1 clean 10 digits", legacy("9000000001"), "valid:9000000001"],
    ["N2 spaces / dashes", legacy("90000 00002"), "normalized_spaces:9000000002"],
    ["N3 +91 prefix", legacy("+91 9000000003"), "normalized_plus91:9000000003"],
    ["N4 91 prefix no plus", legacy("919000000004"), "normalized_plus91:9000000004"],
    ["N5 leading 0", legacy("09000000005"), "normalized_leading0:9000000005"],
    ["N6 two numbers in one cell", legacy("9000000006 / 9000000007"), "multiple:9000000006+9000000007"],
    ["N7 blank", legacy("   "), "blank:"],
    ["N8 too short", legacy("12345"), "bad:"],
    ["N9 starts with 5 (not a mobile)", legacy("5000000008"), "bad:"],
    ["N10 first row with a phone-like value = headerless", isHeaderlessFirstRow(["someone", "9000000009", "x"]), true],
    ["N11 real header row", isHeaderlessFirstRow(["name", "number", "project", "status", "feedback 1", "Column7"]), false],
    ["N12 guess mobile column", guessLegacyColumn(["name", "number", "project"], "mobile"), 1],
    ["N13 guess project column", guessLegacyColumn(["NAME", "NUMBER", "PROJECT NAME"], "project"), 2],
    ["N15 headerless tab: mobile column found by content", guessLegacyMobileColumnByContent([["a", "9000000001", "p"], ["b", "+91 9000000002", "p"], ["c", "", "p"]]), 1],
    ["N16 long text column next to numbers: numbers win", guessLegacyMobileColumnByContent([["a long remark without digits", "9000000001"], ["another long remark here", "9000000002"]]), 1],
    ["T1 text guard: 61 chars rejected", legacyText("x".repeat(61)), "rejected:"],
    ["T2 text guard: holds a phone number rejected", legacyText("call back on 90000 00099 later"), "rejected:"],
    ["T3 text guard: normal text trimmed", legacyText("  visit done  "), "ok:visit done"],
    ["T4 text guard: exactly 60 chars + 9 digits allowed", legacyText("y".repeat(51) + "123456789"), "ok:" + "y".repeat(51) + "123456789"],
    ["T5 text guard: blank is not a rejection", legacyText("   "), "ok:"],
    ["N14 visit cell", [isLegacyVisitDone("visit done 9 sept"), isLegacyVisitDone("no"), isLegacyVisitDone("")].join(","), "true,false,false"],
    ["E1 sweep early exit ON, Tue 10:00 = weekly off until Wed 00:00", (() => { const st = nonWorkingStatusAt(tuesdayOff, ist("2026-10-13T10:00")); return st.isNonWorking ? st.until.getTime() : -1; })(), ist("2026-10-14T00:00")]
  );

  let failures = 0;
  for (const [name, got, expected] of cases) {
    if (got !== expected) {
      failures++;
      console.error(`FAIL ${name}: got ${got}, expected ${expected}`);
    }
  }

  if (failures) {
    console.error(`check-working-calendar: ${failures} of ${cases.length} known answers failed.`);
    process.exit(1);
  }
  console.log(`check-working-calendar: all ${cases.length} known answers pass.`);
}

main().catch((err) => {
  console.error("check-working-calendar: crashed:", err);
  process.exit(1);
});
