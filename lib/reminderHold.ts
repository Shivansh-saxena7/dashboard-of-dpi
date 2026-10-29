// Reminder hold (G5 fix, 2026-10-29). The Follow-up inactivity clock (6 days, see
// calculateSLAStatus.ts) used to ignore a follow-up reminder the owner had set for later, so a
// lead with "call back on 30 Nov" could be recycled weeks before that date.
//
// Rule: the latest reminder the current owner set on this assignment counts as activity at its
// own time, but never more than `maxDays` after the owner's real last activity (so a far-future
// reminder cannot hold a lead forever). The 6-day window then runs from that moment. Pure, no DB
// access; the same rule is mirrored in SQL by reminder_hold_until() for the DB junk guard.
//
// lead_engine_settings.reminder_hold_mode: "off" | "shadow" (default: only logs what it would
// do) | "enforce". Only "enforce" changes any decision.

export type ReminderHoldMode = "off" | "shadow" | "enforce";

export const REMINDER_HOLD_MAX_DAYS_DEFAULT = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export function reminderHoldMode(value: unknown): ReminderHoldMode {
  return value === "shadow" || value === "enforce" ? value : "off";
}

export function reminderHoldMaxDays(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 && n <= 90 ? Math.floor(n) : REMINDER_HOLD_MAX_DAYS_DEFAULT;
}

// The moment the inactivity clock should count from. Returns lastActivityAt unchanged when there
// is no reminder, or the reminder is not later than the last real activity.
export function reminderHoldActivityAt(
  lastActivityAt: string | null | undefined,
  nextReminderAt: string | null | undefined,
  maxDays: number | null | undefined
): string | null {
  if (!lastActivityAt) return lastActivityAt ?? null;
  if (!nextReminderAt) return lastActivityAt;
  const last = Date.parse(lastActivityAt);
  const reminder = Date.parse(nextReminderAt);
  if (!Number.isFinite(last) || !Number.isFinite(reminder) || reminder <= last) return lastActivityAt;
  const cap = last + reminderHoldMaxDays(maxDays ?? REMINDER_HOLD_MAX_DAYS_DEFAULT) * DAY_MS;
  return new Date(Math.min(reminder, cap)).toISOString();
}
