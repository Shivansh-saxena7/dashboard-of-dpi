#!/usr/bin/env node
// Payroll calendar (2026-11-04) known-answer + guard check, run in prebuild. No DB access. Runs under two timezones in the
// same process because the old sandwich code moved dates in the browser's IST timezone.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];
require.extensions[".ts"] = (m, f) =>
  m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, f);
const { addDaysYmd, weekdayOfYmd, istToday, isHolidayYmd, isOnLeaveYmd, monthDatesYmd, payrollDayKind, payrollCountedDates, payrollSandwichDays } = require(path.join(root, "lib/payrollWorkingDays.ts"));

const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`[TZ ${process.env.TZ}] ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const SAT = 6;
const TUE = 2;
const LATER = "2026-12-05";
const diwali = { startsAt: Date.parse("2026-11-06T18:30:00Z"), endsAt: Date.parse("2026-11-10T18:30:00Z"), kind: "HOLIDAY" };
const pause = { startsAt: Date.parse("2026-11-11T18:30:00Z"), endsAt: Date.parse("2026-11-12T18:30:00Z"), kind: "TIMER_PAUSE" };
const ctx = (o = {}) => ({ weeklyOffDay: TUE, ranges: [], leavePeriods: [], joiningDate: null, today: LATER, attendanceDates: new Set(), ...o });

for (const tz of ["Asia/Kolkata", "UTC"]) {
  process.env.TZ = tz;

  // Dates never move
  eq("add day", addDaysYmd("2026-11-16", 1), "2026-11-17");
  eq("back a day", addDaysYmd("2026-11-16", -1), "2026-11-15");
  eq("next month", addDaysYmd("2026-10-31", 1), "2026-11-01");
  eq("previous year", addDaysYmd("2026-01-01", -1), "2025-12-31");
  eq("3 Nov 2026 is a Tuesday", weekdayOfYmd("2026-11-03"), TUE);
  eq("7 Nov 2026 is a Saturday", weekdayOfYmd("2026-11-07"), SAT);
  eq("IST today before midnight UTC", istToday(Date.parse("2026-11-04T18:29:00Z")), "2026-11-04");
  eq("IST today after IST midnight", istToday(Date.parse("2026-11-04T18:30:00Z")), "2026-11-05");
  eq("days in Feb", monthDatesYmd("2026-02").length, 28);

  // Diwali 7 to 10 Nov
  eq("6 Nov is not Diwali", isHolidayYmd("2026-11-06", [diwali]), false);
  eq("7 Nov is Diwali", isHolidayYmd("2026-11-07", [diwali]), true);
  eq("10 Nov is Diwali", isHolidayYmd("2026-11-10", [diwali]), true);
  eq("11 Nov is not Diwali", isHolidayYmd("2026-11-11", [diwali]), false);
  eq("a timer pause is not a day off", isHolidayYmd("2026-11-12", [pause]), false);
  eq("part of a day is not a day off", isHolidayYmd("2026-11-07", [{ ...diwali, endsAt: Date.parse("2026-11-07T06:30:00Z") }]), false);

  // November 2026 with no attendance: 30 days, 4 weekly offs, Diwali takes 3 more either way
  eq("Nov, Tuesday off, no holiday", payrollCountedDates("2026-11", ctx()).length, 26);
  eq("Nov, Tuesday off, Diwali", payrollCountedDates("2026-11", ctx({ ranges: [diwali] })).length, 23);
  eq("Nov, Saturday off, Diwali", payrollCountedDates("2026-11", ctx({ weeklyOffDay: SAT, ranges: [diwali] })).length, 23);
  eq("Diwali days are not counted", payrollCountedDates("2026-11", ctx({ ranges: [diwali] })).filter((d) => d >= "2026-11-07" && d <= "2026-11-10"), []);
  eq("day kind on Diwali", payrollDayKind("2026-11-08", ctx({ ranges: [diwali] })), "HOLIDAY");
  eq("weekly off wins on 10 Nov", payrollDayKind("2026-11-10", ctx({ ranges: [diwali] })), "WEEKLY_OFF");

  // 3 Nov weekly off
  eq("3 Nov off with Tuesday", payrollDayKind("2026-11-03", ctx()), "WEEKLY_OFF");
  eq("3 Nov counted with Saturday", payrollDayKind("2026-11-03", ctx({ weeklyOffDay: SAT })), "COUNTED");
  eq("31 Oct counted with Tuesday", payrollDayKind("2026-10-31", ctx()), "COUNTED");
  eq("no weekly off set", payrollCountedDates("2026-11", ctx({ weeklyOffDay: null })).length, 30);

  // Joining in the middle of the month: 15 to 31 Oct is 17 days, Tuesdays 20 and 27 are off
  eq("join 15 Oct", payrollCountedDates("2026-10", ctx({ joiningDate: "2026-10-15" })).length, 15);
  eq("day before joining", payrollDayKind("2026-10-14", ctx({ joiningDate: "2026-10-15" })), "BEFORE_JOINING");
  eq("joining day counts", payrollDayKind("2026-10-15", ctx({ joiningDate: "2026-10-15" })), "COUNTED");
  eq("joined after the month", payrollCountedDates("2026-10", ctx({ joiningDate: "2026-11-02" })).length, 0);
  eq("no joining date: whole month", payrollCountedDates("2026-10", ctx()).length, 27);

  // Leave
  const oneDay = [{ start_date: "2026-10-07", end_date: "2026-10-07" }];
  eq("one leave day", payrollCountedDates("2026-10", ctx({ leavePeriods: oneDay })).length, 26);
  eq("leave day kind", payrollDayKind("2026-10-07", ctx({ leavePeriods: oneDay })), "LEAVE");
  eq("day after leave", payrollDayKind("2026-10-08", ctx({ leavePeriods: oneDay })), "COUNTED");
  eq("open leave runs on", isOnLeaveYmd("2026-12-25", [{ start_date: "2026-08-27", end_date: null }]), true);
  eq("before open leave", isOnLeaveYmd("2026-08-26", [{ start_date: "2026-08-27", end_date: null }]), false);

  // Today and later
  const today4 = { today: "2026-11-04", weeklyOffDay: SAT };
  eq("future days are not counted", payrollCountedDates("2026-11", ctx(today4)), ["2026-11-01", "2026-11-02", "2026-11-03"]);
  eq("today counts once attended", payrollCountedDates("2026-11", ctx({ ...today4, attendanceDates: new Set(["2026-11-04"]) })).length, 4);
  eq("a later month has nothing yet", payrollCountedDates("2026-12", ctx(today4)).length, 0);
  eq("a finished month is whole", payrollCountedDates("2026-10", ctx({ ...today4 })).length, 26);

  // Sandwich, with the date bug's own case: Tuesday 17 Nov checks Monday 16 and Wednesday 18
  const all = (dates) => new Set(dates);
  const novExcept = (...gone) => monthDatesYmd("2026-11").concat(["2026-10-31", "2026-12-01"]).filter((d) => !gone.includes(d));
  eq("sandwich: both sides absent", payrollSandwichDays("2026-11", ctx({ attendanceDates: all(novExcept("2026-11-16", "2026-11-18")) })), 1);
  eq("sandwich: only the day before absent", payrollSandwichDays("2026-11", ctx({ attendanceDates: all(novExcept("2026-11-16")) })), 0);
  eq("sandwich: two days before is not next to it", payrollSandwichDays("2026-11", ctx({ attendanceDates: all(novExcept("2026-11-15", "2026-11-18")) })), 0);
  eq("sandwich: holiday next to the off is no absence", payrollSandwichDays("2026-11", ctx({ ranges: [diwali], attendanceDates: all(novExcept("2026-11-07", "2026-11-08", "2026-11-09", "2026-11-11")) })), 0);
  eq("sandwich: leave next to the off is no absence", payrollSandwichDays("2026-11", ctx({ leavePeriods: [{ start_date: "2026-11-16", end_date: "2026-11-16" }], attendanceDates: all(novExcept("2026-11-16", "2026-11-18")) })), 0);
  eq("sandwich: tomorrow is not an absence yet", payrollSandwichDays("2026-11", ctx({ today: "2026-11-17", attendanceDates: all(novExcept("2026-11-16", "2026-11-18")) })), 0);
  eq("sandwich: across the month end", payrollSandwichDays("2026-10", ctx({ weeklyOffDay: SAT, attendanceDates: all(monthDatesYmd("2026-10").filter((d) => d !== "2026-10-30").concat(["2026-11-02"])) })), 1);
  eq("sandwich: before joining is no absence", payrollSandwichDays("2026-11", ctx({ joiningDate: "2026-11-18", attendanceDates: all(novExcept("2026-11-16", "2026-11-18")) })), 0);
}

const compute = read("lib/computePayrollAdjustments.ts");
const start = compute.indexOf("export async function computeAttendanceDeductionForMonth");
const fn = compute.slice(start, compute.indexOf("export interface ReimbursementComputeResult"));
if (/toISOString/.test(fn.replace(/fetchWorkingCalendar\([^)]*\)/, ""))) problems.push("the LOP compute must not use toISOString for a date");
if (!fn.includes("fetchWorkingCalendar(")) problems.push("the LOP compute must read the working calendar");
if (!fn.includes("employee_leave_periods")) problems.push("the LOP compute must read leave periods");
if (!fn.includes("date_of_joining")) problems.push("the LOP compute must read the joining date");
if (/\.created_at|"created_at"/.test(fn)) problems.push("created_at is not a joining date");
if (!fn.includes("payrollCountedDates(") || !fn.includes("payrollSandwichDays(")) problems.push("the LOP compute must use lib/payrollWorkingDays");

if (problems.length) {
  console.error("check-payroll-calendar: FAILED");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log("check-payroll-calendar: all known answers and guards pass.");
