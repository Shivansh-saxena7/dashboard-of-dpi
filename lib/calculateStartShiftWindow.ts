import { toISTMinutesSinceMidnight, timeStringToMinutes, formatTimeStringAsClock } from "./istTime.ts";

// Single source of truth for "is Start Shift clickable right now, and
// which half does it fall into" — same pattern as the other
// lib/calculate*.ts files: pure function, no DB access. Called both
// server-side (start-shift Edge Function, authoritative) and
// client-side (StartShiftCard.tsx, for instant UI feedback) —
// exactly like calculateGeofenceStatus already is.
export type ShiftHalf = "FIRST" | "SECOND";

export interface StartShiftWindowConfig {
  firstHalfStartTime: string;          // existing config, window 1 start
  firstHalfStartWindowEnd: string;
  secondHalfStartWindowStart: string;  // existing half_day_boundary_time, window 2 start
  secondHalfStartWindowEnd: string;
}

export interface StartShiftWindowResult {
  allowed: boolean;
  half: ShiftHalf | null;
  reason?: string;
}

export function calculateStartShiftWindow(
  now: Date,
  config: StartShiftWindowConfig
): StartShiftWindowResult {

  const nowMinutes = toISTMinutesSinceMidnight(now);

  const firstStart = timeStringToMinutes(config.firstHalfStartTime);
  const firstEnd = timeStringToMinutes(config.firstHalfStartWindowEnd);
  const secondStart = timeStringToMinutes(config.secondHalfStartWindowStart);
  const secondEnd = timeStringToMinutes(config.secondHalfStartWindowEnd);

  if (nowMinutes >= firstStart && nowMinutes <= firstEnd) {
    return { allowed: true, half: "FIRST" };
  }

  if (nowMinutes >= secondStart && nowMinutes <= secondEnd) {
    return { allowed: true, half: "SECOND" };
  }

  return {
    allowed: false,
    half: null,
    reason:
      `The shift start window has closed. You can only start your shift between ` +
      `${formatTimeStringAsClock(config.firstHalfStartTime)}-${formatTimeStringAsClock(config.firstHalfStartWindowEnd)} ` +
      `or ${formatTimeStringAsClock(config.secondHalfStartWindowStart)}-${formatTimeStringAsClock(config.secondHalfStartWindowEnd)}.`
  };

}
