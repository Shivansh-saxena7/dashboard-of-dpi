// Recycle hours (2026-10-08, Option A Phase 1). Nobody ever presses End
// Shift (0 of 47 shifts since 1 Oct), so an employee counts as "on shift"
// from Start Shift until 05:30 IST next morning (attendance.date is the
// UTC date) — ~800 recycles in 14 days went to people at night. The
// recycle sweep therefore only hands out recycled leads inside the
// working day:
//   from first_half_start_time (the earliest anyone can Start Shift —
//   before it, an "open shift" can only be yesterday's unended one)
//   until sla_office_end_time + a grace.
// Both times come from lead_engine_settings (never hardcoded), read every
// sweep, so a settings change applies on the next sweep. Only recycle
// eligibility uses this — Start Shift, attendance and new-lead
// assignment are untouched (Phase 2).

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

// "HH:MM" or "HH:MM:SS" -> minutes after midnight.
function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function isWithinRecycleHours(
  nowMs: number,
  dayStartTime: string,   // lead_engine_settings.first_half_start_time
  officeEndTime: string,  // lead_engine_settings.sla_office_end_time
  graceMinutes: number
): boolean {
  const local = new Date(nowMs + IST_OFFSET_MS);
  const minuteOfDay = local.getUTCHours() * 60 + local.getUTCMinutes();
  return minuteOfDay >= minutesOf(dayStartTime) && minuteOfDay < minutesOf(officeEndTime) + graceMinutes;
}
