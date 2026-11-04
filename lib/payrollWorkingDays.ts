// Which days of a month count for attendance LOP (2026-11-04). Pure, no DB access, works on plain YYYY-MM-DD dates so the
// browser's timezone can never move a date. Known-answer tested in scripts/check-payroll-calendar.js.
//
// A day is not counted when it is the weekly off, a whole-day Admin HOLIDAY (a TIMER_PAUSE is not a day off: people still
// work), an approved or open leave, before the joining date, or still to come. Today counts only once it has an attendance
// row, because a shift that has not started yet is not an absence.
//
// Still one weekly off for the whole month: changing the setting changes past months too. Per-date history is a separate job.

export type PayrollDayKind = "COUNTED" | "WEEKLY_OFF" | "HOLIDAY" | "LEAVE" | "BEFORE_JOINING" | "NOT_YET";

export interface PayrollHolidayRange {
  startsAt: number;
  endsAt: number;
  kind: string;
}

export interface PayrollLeavePeriod {
  start_date: string;
  end_date: string | null;
}

export interface PayrollDayContext {
  weeklyOffDay: number | null;
  ranges: PayrollHolidayRange[];
  leavePeriods: PayrollLeavePeriod[];
  joiningDate: string | null;
  today: string;
  attendanceDates: ReadonlySet<string>;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function ymdToUtcMs(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDaysYmd(ymd: string, days: number): string {
  return new Date(ymdToUtcMs(ymd) + days * DAY_MS).toISOString().slice(0, 10);
}

export function weekdayOfYmd(ymd: string): number {
  return new Date(ymdToUtcMs(ymd)).getUTCDay();
}

export function istToday(nowMs: number = Date.now()): string {
  return new Date(nowMs + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// A HOLIDAY range must cover the whole IST day. Ranges are stored from IST midnight to IST midnight.
export function isHolidayYmd(ymd: string, ranges: PayrollHolidayRange[]): boolean {
  const dayStart = ymdToUtcMs(ymd) - IST_OFFSET_MS;
  const dayEnd = dayStart + DAY_MS;
  return ranges.some((r) => r.kind === "HOLIDAY" && r.startsAt <= dayStart && r.endsAt >= dayEnd);
}

export function isOnLeaveYmd(ymd: string, periods: PayrollLeavePeriod[]): boolean {
  return periods.some((p) => p.start_date <= ymd && (!p.end_date || p.end_date >= ymd));
}

export function monthDatesYmd(yyyyMm: string): string[] {
  const [y, m] = yyyyMm.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: daysInMonth }, (_, i) => `${yyyyMm}-${String(i + 1).padStart(2, "0")}`);
}

export function payrollDayKind(ymd: string, ctx: PayrollDayContext): PayrollDayKind {
  if (ctx.joiningDate && ymd < ctx.joiningDate) return "BEFORE_JOINING";
  if (ymd > ctx.today || (ymd === ctx.today && !ctx.attendanceDates.has(ymd))) return "NOT_YET";
  if (ctx.weeklyOffDay !== null && weekdayOfYmd(ymd) === ctx.weeklyOffDay) return "WEEKLY_OFF";
  if (isHolidayYmd(ymd, ctx.ranges)) return "HOLIDAY";
  if (isOnLeaveYmd(ymd, ctx.leavePeriods)) return "LEAVE";
  return "COUNTED";
}

export function payrollCountedDates(yyyyMm: string, ctx: PayrollDayContext): string[] {
  return monthDatesYmd(yyyyMm).filter((ymd) => payrollDayKind(ymd, ctx) === "COUNTED");
}

// Sandwich leave: a weekly off with a real absence on both sides. A neighbour that is a holiday, a leave, before joining or
// still to come is not an absence. The neighbour may be in the next or previous month; attendanceDates must cover those days.
export function payrollSandwichDays(yyyyMm: string, ctx: PayrollDayContext): number {
  const absent = (ymd: string) => payrollDayKind(ymd, ctx) === "COUNTED" && !ctx.attendanceDates.has(ymd);
  return monthDatesYmd(yyyyMm).filter(
    (ymd) => payrollDayKind(ymd, ctx) === "WEEKLY_OFF" && absent(addDaysYmd(ymd, -1)) && absent(addDaysYmd(ymd, 1))
  ).length;
}
