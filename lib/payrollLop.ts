// LOP in rupees on the salary slip (2026-11-13, owner's decision):
//   one day's pay = monthly basic pay / the number of days in that month (28, 29, 30 or 31)
//   LOP amount   = round(basic / days in month * LOP days), to the nearest rupee (.5 rounds up)
//   base         = basic pay only
//   LOP days     = what the attendance compute gives (absences, sandwich days, half days as 0.5); days before the
//                  joining date are never LOP days (lib/payrollWorkingDays.ts marks them BEFORE_JOINING)
//   paid days    = days in month - LOP days
// Pure, no DB access. Known-answer tested in scripts/check-payroll-lop.js. Used by lib/generateHrDocumentPdf.ts for
// both the single and the bulk slip, and by app/payroll/salary/page.tsx.

export function daysInMonthYm(yyyyMm: string): number {
  const [y, m] = yyyyMm.split("-").map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return 0;
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// LOP days that can count: a number, not below 0, not above the month.
export function clampLopDays(lopDays: number, daysInMonth: number): number {
  if (!Number.isFinite(lopDays) || lopDays <= 0 || !Number.isFinite(daysInMonth) || daysInMonth <= 0) return 0;
  return Math.min(lopDays, daysInMonth);
}

export function computeLopAmount(basicPay: number, daysInMonth: number, lopDays: number): number {
  if (!Number.isFinite(basicPay) || basicPay <= 0) return 0;
  const days = clampLopDays(lopDays, daysInMonth);
  if (days === 0) return 0;
  const raw = (basicPay * days) / daysInMonth;
  // Strip floating-point noise first, so an exact .5 rounds up and 1666.6666 rounds to 1667.
  return Math.round(Math.round(raw * 1e6) / 1e6);
}

export function computePaidDays(daysInMonth: number, lopDays: number): number {
  if (!Number.isFinite(daysInMonth) || daysInMonth <= 0) return 0;
  return daysInMonth - clampLopDays(lopDays, daysInMonth);
}

// "LOP (2.5 days)", "LOP (1 day)", "LOP (0 days)".
export function lopDeductionLabel(lopDays: number): string {
  const d = Number.isFinite(lopDays) && lopDays > 0 ? lopDays : 0;
  return `LOP (${d} day${d === 1 ? "" : "s"})`;
}
