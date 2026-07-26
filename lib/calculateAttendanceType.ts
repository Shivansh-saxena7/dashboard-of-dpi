import { toISTMinutesSinceMidnight, timeStringToMinutes } from "./istTime.ts";

// Classifies a timestamp as being on the FULL_DAY side or the
// HALF_DAY_SECOND side of half_day_boundary_time — same pattern as
// the other lib/calculate*.ts files: pure function, no DB access.
//
// This function is NOT used for start-time classification anymore —
// now that Start Shift is gated to two narrow windows (see
// calculateStartShiftWindow.ts), the attendance_type at start time is
// simply whichever window matched (FIRST -> FULL_DAY, SECOND ->
// HALF_DAY_SECOND), no boundary comparison needed there. This
// function's remaining job is the end-shift half-day correction: is
// the END time before the boundary, meaning a FULL_DAY shift that
// started on time actually stopped after only the first half?
//
// HALF_DAY_FIRST is never returned by this function — see
// supabase/functions/end-shift for where that correction is applied.
export type InitialAttendanceType = "FULL_DAY" | "HALF_DAY_SECOND";

export function calculateAttendanceType(
  shiftStartAt: Date,
  halfDayBoundaryTime: string
): InitialAttendanceType {

  const shiftStartISTMinutes = toISTMinutesSinceMidnight(shiftStartAt);
  const boundaryISTMinutes = timeStringToMinutes(halfDayBoundaryTime);

  return shiftStartISTMinutes < boundaryISTMinutes ? "FULL_DAY" : "HALF_DAY_SECOND";

}
