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
const { workingAdd, workingElapsedMs, nonWorkingStatusAt, loadJobWorkingCalendar, DAY_MS } = loadLib("workingCalendar.ts");
const { calculateSLAStatus, getRecycleCutoff } = loadLib("calculateSLAStatus.ts");
const { recyclingTomorrowCutoff } = loadLib("recyclingTomorrow.ts");

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
  ["S5 NOT_INTERESTED cooldown unchanged when ON (Step 5)", cutoffMs(cooldown, tuesdayOff, "2026-10-12T17:00:00+05:30"), ist("2026-10-19T17:00")],
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
