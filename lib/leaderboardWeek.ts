// IST-explicit date helpers + "most recently completed Monday-Sunday
// week" calculation — single owner (Golden Rule) for logic that used
// to live only inline inside Header.tsx's Tuesday-popup-trigger
// effect. Now also consumed by app/leaderboard/page.tsx (the
// permanent Weekly Visits view), which needs the SAME week on every
// day of the week it's opened, not just Tuesday — so
// getMostRecentCompletedWeek() is written generically (works for any
// getISTParts() input) rather than assuming "today is Tuesday" the
// way the old inline version implicitly did.

export interface ISTParts {
  year: number;
  month: number; // 0-indexed
  dayOfMonth: number;
  dayOfWeek: number; // 0=Sunday..6=Saturday
  hour: number;
  minute: number;
}

// IST wall-clock parts, independent of the device's own timezone.
// toLocaleString(..., {timeZone}) renders the IST wall-clock as a
// string; re-parsing it via `new Date()` interprets that string in
// the BROWSER's local zone, which is exactly the trick that makes the
// resulting getHours()/getDay()/etc. reflect IST regardless of device
// settings.
export function getISTParts(): ISTParts {
  const now = new Date();
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  return {
    year: ist.getFullYear(),
    month: ist.getMonth(),
    dayOfMonth: ist.getDate(),
    dayOfWeek: ist.getDay(),
    hour: ist.getHours(),
    minute: ist.getMinutes()
  };
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// year/month(0-indexed)/day -> "YYYY-MM-DD", built from plain
// integers rather than a Date's own toISOString() — that goes through
// a UTC round-trip that can silently shift the date by a day
// depending on the device's timezone.
export function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

export function formatShortDate(year: number, month: number, day: number): string {
  return new Date(year, month, day).toLocaleDateString([], { month: "short", day: "numeric" });
}

export interface CompletedWeek {
  startYear: number;
  startMonth: number;
  startDay: number;
  endYear: number;
  endMonth: number;
  endDay: number;
  periodKey: string; // week-start "YYYY-MM-DD", matches leaderboard_popup_views.period_key
}

// The most recently FULLY completed Monday-Sunday week, as of `parts`
// (today). daysSinceMonday treats Sunday (getDay()===0) as 6 days
// since Monday, so "this week's Monday" is always <= today regardless
// of which day of the week today is. The completed week is the one
// immediately before that. On a Tuesday this reduces to exactly the
// old inline formula (today - 8), which is how the popup-trigger in
// Header.tsx was already computing it — verified with a standalone
// date-arithmetic script before this extraction (Tuesday, first-
// working-day, cross-year-boundary, and 1st-of-month-is-the-off-day
// cases all checked).
export function getMostRecentCompletedWeek(parts: ISTParts): CompletedWeek {
  const daysSinceMonday = (parts.dayOfWeek + 6) % 7;
  const completedWeekStart = new Date(parts.year, parts.month, parts.dayOfMonth - daysSinceMonday - 7);
  const completedWeekEnd = new Date(completedWeekStart);
  completedWeekEnd.setDate(completedWeekEnd.getDate() + 6);

  return {
    startYear: completedWeekStart.getFullYear(),
    startMonth: completedWeekStart.getMonth(),
    startDay: completedWeekStart.getDate(),
    endYear: completedWeekEnd.getFullYear(),
    endMonth: completedWeekEnd.getMonth(),
    endDay: completedWeekEnd.getDate(),
    periodKey: ymd(completedWeekStart.getFullYear(), completedWeekStart.getMonth(), completedWeekStart.getDate())
  };
}
