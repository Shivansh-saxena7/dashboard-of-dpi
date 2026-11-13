#!/usr/bin/env node
// LOP in rupees (2026-11-13): known answers + guards, run in prebuild. No DB access, never runs a payroll compute.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];
require.extensions[".ts"] = (m, f) =>
  m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, f);
const { daysInMonthYm, clampLopDays, computeLopAmount, computePaidDays, lopDeductionLabel } = require(path.join(root, "lib/payrollLop.ts"));
const { payrollCountedDates, payrollSandwichDays, monthDatesYmd } = require(path.join(root, "lib/payrollWorkingDays.ts"));

const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// Days in month
eq("Nov has 30", daysInMonthYm("2026-11"), 30);
eq("Dec has 31", daysInMonthYm("2026-12"), 31);
eq("Feb 2026 has 28", daysInMonthYm("2026-02"), 28);
eq("Feb 2028 has 29", daysInMonthYm("2028-02"), 29);
eq("bad month", daysInMonthYm("2026-13"), 0);

// Amount = round(basic / days in month * LOP days)
eq("30-day month, 1 day", computeLopAmount(30000, 30, 1), 1000);
eq("31-day month, 1 day", computeLopAmount(31000, 31, 1), 1000);
eq("31-day month, 3 days", computeLopAmount(20000, 31, 3), 1935); // 1935.48
eq("0 LOP", computeLopAmount(20000, 30, 0), 0);
eq("half day", computeLopAmount(20000, 30, 0.5), 333); // 333.33
eq("2.5 days (sample slip)", computeLopAmount(20000, 30, 2.5), 1667); // 1666.67
eq("Feb 28, 2 days", computeLopAmount(28000, 28, 2), 2000);
eq("Feb 29, 2 days", computeLopAmount(29000, 29, 2), 2000);
eq("Feb 28 vs 29 differ", [computeLopAmount(20000, 28, 1), computeLopAmount(20000, 29, 1)], [714, 690]); // 714.29, 689.66
eq("exact whole result", computeLopAmount(300, 30, 0.5), 5); // 300/30*0.5 = 5
eq("exact .5 rounds up", computeLopAmount(31, 31, 0.5), 1); // 0.5 -> 1
eq("exact 2.5 rounds up", computeLopAmount(150, 30, 0.5), 3); // 2.5 -> 3
eq(".49 rounds down", computeLopAmount(31, 31, 0.49), 0); // 0.49 -> 0
eq(".9 rounds up", computeLopAmount(1049, 10, 1), 105); // 104.9 -> 105
eq("float noise: 1/3 day steps", computeLopAmount(9000, 30, 1.5), 450);
eq("more LOP than days -> whole basic", computeLopAmount(20000, 30, 45), 20000);
eq("negative LOP -> 0", computeLopAmount(20000, 30, -2), 0);
eq("NaN LOP -> 0", computeLopAmount(20000, 30, NaN), 0);
eq("no basic -> 0", computeLopAmount(0, 30, 2), 0);
eq("no days in month -> 0", computeLopAmount(20000, 0, 2), 0);

// Paid days = days in month - LOP days
eq("paid days 30 - 2.5", computePaidDays(30, 2.5), 27.5);
eq("paid days 31 - 0", computePaidDays(31, 0), 31);
eq("paid days never below 0", computePaidDays(30, 45), 0);
eq("clamp", [clampLopDays(2.5, 30), clampLopDays(-1, 30), clampLopDays(40, 30)], [2.5, 0, 30]);
eq("label 2.5", lopDeductionLabel(2.5), "LOP (2.5 days)");
eq("label 1", lopDeductionLabel(1), "LOP (1 day)");
eq("label 0", lopDeductionLabel(0), "LOP (0 days)");

// Sandwich days count as LOP days: Sat off (old Navratri value) with absences on Fri and Sun around it.
{
  const SAT = 6;
  const att = new Set(monthDatesYmd("2026-11").filter((d) => !["2026-11-13", "2026-11-15"].includes(d)));
  const ctx = { weeklyOffDay: SAT, ranges: [], leavePeriods: [], joiningDate: null, today: "2026-12-05", attendanceDates: att };
  const counted = payrollCountedDates("2026-11", ctx);
  const absences = counted.filter((d) => !att.has(d)).length;
  const sandwich = payrollSandwichDays("2026-11", ctx);
  eq("sandwich: 2 absences + 1 sandwich day", [absences, sandwich], [2, 1]);
  eq("sandwich: 3 LOP days in rupees", computeLopAmount(30000, 30, absences + sandwich), 3000);
}

// Mid-month joining: days before the joining date are not LOP days; the month still divides by all its days.
{
  const att = new Set(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
  const ctx = { weeklyOffDay: 2, ranges: [], leavePeriods: [], joiningDate: "2026-11-16", today: "2026-11-21", attendanceDates: att };
  const counted = payrollCountedDates("2026-11", ctx);
  const absences = counted.filter((d) => !att.has(d)).length; // 16-20 Nov worked (17 is Tuesday off), 21 is today
  eq("joining 16 Nov: no LOP for 1-15 Nov", [counted.every((d) => d >= "2026-11-16"), absences], [true, 0]);
  eq("joining 16 Nov: 1 real absence later = 1 day of pay", computeLopAmount(30000, 30, 1), 1000);
}

// Guards: the slip uses it for single and bulk, and net pay goes down by it.
const pdf = read("lib/generateHrDocumentPdf.ts");
if (!pdf.includes("const lopAmount = computeLopAmount(input.basicPay, input.daysInMonth, input.lopDays);")) problems.push("the slip must work out LOP in rupees with computeLopAmount");
if (!pdf.includes("const totalDeductions = performanceCutAmount + lopAmount;")) problems.push("LOP must be part of Total Deductions (and so of Net Pay)");
if (!pdf.includes("deductions.push([lopDeductionLabel(")) problems.push('the slip must show the "LOP (X days)" deduction line');
if (!pdf.includes("computePaidDays(input.daysInMonth, input.lopDays)")) problems.push("Paid Days on the slip must be days in month minus LOP days");
const page = read("app/payroll/salary/page.tsx");
if ((page.match(/paidDays: computePaidDays\(daysInMonth, /g) || []).length !== 2) problems.push("single and bulk slips must both pass Paid Days = days in month - LOP days");
if (page.includes("paidDaysOverride")) problems.push("Paid Days is no longer typed by hand");

if (problems.length) {
  console.error("check-payroll-lop: FAILED");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log("check-payroll-lop: all known answers and guards pass.");
