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

const source = fs.readFileSync(path.join(__dirname, "..", "lib", "workingCalendar.ts"), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
});
const mod = { exports: {} };
new Function("module", "exports", outputText)(mod, mod.exports);
const { workingAdd, workingElapsedMs, nonWorkingStatusAt, DAY_MS } = mod.exports;

const HOUR = 60 * 60 * 1000;
const ist = (s) => new Date(`${s}+05:30`).getTime();
const range = (from, to, kind, reason) => ({ id: null, startsAt: ist(from), endsAt: ist(to), kind, reason });

const tuesdayOff = { weeklyOffDay: 2, ranges: [] };
const holiday = range("2026-10-14T00:00", "2026-10-15T00:00", "HOLIDAY", "TEST holiday");
const pause = range("2026-10-16T12:00", "2026-10-16T18:00", "TIMER_PAUSE", "TEST pause");
const withHoliday = { weeklyOffDay: 2, ranges: [holiday] };
const withBoth = { weeklyOffDay: 2, ranges: [holiday, pause] };
const wednesdayOff = { weeklyOffDay: 3, ranges: [] };
const now = Date.now();

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
  ["Status: Mon working", nonWorkingStatusAt(tuesdayOff, ist("2026-10-12T10:00")).isNonWorking ? 1 : 0, 0]
];

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
