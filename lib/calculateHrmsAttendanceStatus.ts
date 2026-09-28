import { toISTMinutesSinceMidnight, timeStringToMinutes } from "./istTime.ts";

// HRMS Attendance status -- genuinely independent from the existing
// Lead-Distribution Shift-Start gate (calculateAttendanceType.ts /
// calculateStartShiftWindow.ts), which stays completely untouched. This
// reuses the SAME raw shift_start_at + attendance_type values that
// system already writes, but applies a different, stricter cutoff
// purely for HR reporting -- it never feeds back into lead assignment.

export type DailyHrmsStatus = "ON_TIME" | "LATE_COMING" | "ABSENT";
export type MonthlyHrmsStatus = "ON_TIME" | "LATE_COMING" | "HALF_DAY" | "ABSENT";

// Shared across BOTH halves -- a first-half late-coming and a
// second-half late-coming count against the exact same monthly
// allowance, per explicit correction. Only the first 2 in a calendar
// month are free.
export const MAX_FREE_LATE_COMINGS_PER_MONTH = 2;

interface AttendanceRowForHrms {
  // Whichever window the existing Start-Shift flow already classified
  // this row into -- not re-derived here, so this can never disagree
  // with which window the employee actually used. HALF_DAY_FIRST (the
  // end-shift early-checkout correction -- see
  // calculateAttendanceType.ts) is still a first-half start, so it's
  // evaluated against the same cutoff as FULL_DAY.
  attendance_type: "FULL_DAY" | "HALF_DAY_SECOND" | "HALF_DAY_FIRST" | null;
  shift_start_at: string;
}

interface HrmsSettingsForCalc {
  first_half_ontime_cutoff: string; // e.g. "10:35:00"
  second_half_ontime_cutoff: string; // e.g. "13:30:00"
}

// Per-day status for one employee, one date. `row` is null when no
// attendance row exists for that date at all -- the existing
// Start-Shift button is structurally incapable of producing a row
// outside its own two windows, so "no row" is the only way a day can
// be neither on-time nor late: it's a full miss (ABSENT), which never
// counts toward the late-coming allowance below.
export function calculateDailyHrmsStatus(
  row: AttendanceRowForHrms | null,
  settings: HrmsSettingsForCalc
): DailyHrmsStatus {

  if (!row) {
    return "ABSENT";
  }

  const shiftStartMinutes = toISTMinutesSinceMidnight(new Date(row.shift_start_at));

  const cutoff =
    row.attendance_type === "HALF_DAY_SECOND"
      ? settings.second_half_ontime_cutoff
      : settings.first_half_ontime_cutoff;

  return shiftStartMinutes <= timeStringToMinutes(cutoff) ? "ON_TIME" : "LATE_COMING";
}

// Monthly rollup for one employee's one calendar month. `dailyStatuses`
// must already be in chronological order, one entry per expected
// working day (the caller excludes weekly-offs/holidays before calling
// this -- this function only ever sees days attendance was actually
// expected). The 1st and 2nd LATE_COMING day cost nothing; the 3rd
// (and every one after, in the same month) converts that day to
// HALF_DAY. ABSENT days pass through unchanged -- a full miss is a
// different, unrelated case from being late.
export function applyMonthlyLateComingRule(
  dailyStatuses: DailyHrmsStatus[]
): MonthlyHrmsStatus[] {

  let lateComingCount = 0;

  return dailyStatuses.map((status) => {
    if (status !== "LATE_COMING") {
      return status;
    }

    lateComingCount++;

    return lateComingCount > MAX_FREE_LATE_COMINGS_PER_MONTH ? "HALF_DAY" : "LATE_COMING";
  });
}
