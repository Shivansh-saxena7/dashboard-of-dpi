import { toISTMinutesSinceMidnight, timeStringToMinutes, formatTimeStringAsClock } from "./istTime.ts";

// Single source of truth for "is End Shift clickable right now" —
// same pattern as the other lib/calculate*.ts files: pure function,
// no DB access, no grace window (exact cutoffs only, per spec).
export interface EndShiftWindowResult {
  allowed: boolean;
  reason?: string;
}

// startedAttendanceType is the attendance row's attendance_type,
// read BEFORE any half-day correction is applied in this same
// end-shift call. This reuse is safe because start-shift only ever
// sets FULL_DAY (First-Half window) or HALF_DAY_SECOND (Second-Half
// window) — see calculateStartShiftWindow.ts — so this one value
// alone tells us which minimum end-time cutoff applies. No separate
// column was needed just to track "which half did they start."
export function calculateEndShiftWindow(
  now: Date,
  startedAttendanceType: "FULL_DAY" | "HALF_DAY_SECOND",
  firstHalfMinEndTime: string,
  secondHalfMinEndTime: string
): EndShiftWindowResult {

  const nowMinutes = toISTMinutesSinceMidnight(now);

  if (startedAttendanceType === "FULL_DAY") {
    const minEndMinutes = timeStringToMinutes(firstHalfMinEndTime);

    if (nowMinutes < minEndMinutes) {
      return {
        allowed: false,
        reason: `You can't end your shift yet. A First-Half shift can only be ended after ${formatTimeStringAsClock(firstHalfMinEndTime)}.`
      };
    }

    return { allowed: true };
  }

  if (startedAttendanceType === "HALF_DAY_SECOND") {
    const minEndMinutes = timeStringToMinutes(secondHalfMinEndTime);

    if (nowMinutes < minEndMinutes) {
      return {
        allowed: false,
        reason: `You can't end your shift yet. A Second-Half shift can only be ended after ${formatTimeStringAsClock(secondHalfMinEndTime)}.`
      };
    }

    return { allowed: true };
  }

  // Defensive fallback — shouldn't happen, since start-shift only
  // ever sets one of the two values handled above.
  return {
    allowed: false,
    reason: "Shift type could not be determined."
  };

}
