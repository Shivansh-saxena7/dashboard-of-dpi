// Shared IST (India Standard Time, UTC+5:30, no DST) time-of-day
// helpers. Extracted here because getting this math right is easy to
// get subtly wrong (see the timezone note previously in
// calculateAttendanceType.ts) and it's now needed by multiple files —
// one implementation, reused everywhere, per this project's
// one-owner principle. This file is imported both from Next.js
// (lib/*.ts, components/*.tsx) and from Deno Edge Functions
// (supabase/functions/*), which is why every relative import of it
// uses the explicit ".ts" extension — Deno requires it.

const IST_OFFSET_MINUTES = 5 * 60 + 30;
const MINUTES_PER_DAY = 24 * 60;

// Converts a Date's instant into "minutes since midnight, IST" —
// correct regardless of which timezone the calling runtime itself is
// in (Edge Functions default to UTC; browsers default to the user's
// local zone), since it always starts from UTC components.
export function toISTMinutesSinceMidnight(date: Date): number {
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return (utcMinutes + IST_OFFSET_MINUTES) % MINUTES_PER_DAY;
}

// Accepts "HH:MM" or "HH:MM:SS", as Postgres returns a `time` column
// via the Supabase client. Config values are assumed to already
// represent IST wall-clock times (DPI operates in India).
export function timeStringToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

// For building human-readable messages from config values, e.g.
// "10:30 AM" from "10:30:00" — used when generating window-violation
// reasons so the text always reflects actual configured times, never
// a hardcoded string.
export function formatTimeStringAsClock(time: string): string {
  const totalMinutes = timeStringToMinutes(time);
  const hours24 = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;

  return `${hours12}:${String(minutes).padStart(2, "0")} ${period}`;
}

// Date-range-filter boundary helpers (2026-10-01). A "YYYY-MM-DD"
// string from an <input type="date"> always means an IST calendar day
// here (DPI operates in India) -- but `new Date("YYYY-MM-DD")` is
// specified to parse a bare date-only string as UTC midnight, not
// local/IST midnight. Every custom-date-range filter in this app
// (admin leads, Coordinator dashboard) was building its boundaries
// with plain `new Date(dateStr)`, silently shifting both ends of the
// window 5.5 hours later than intended -- invisible on a day with no
// lead activity in the 00:00-05:29 IST gap, but a real, confirmed
// latent bug on any day that does. These two helpers are the correct
// replacement; both are "YYYY-MM-DDT..+05:30" ISO strings with an
// explicit offset, which every JS engine parses correctly regardless
// of which timezone the runtime itself defaults to.
export function istDateStringToRangeStartUTC(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000+05:30`);
}

export function istDateStringToRangeEndUTC(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59.999+05:30`);
}
