// Shared display helpers for HRMS attendance -- single owner, reused
// by both app/hr/attendance/page.tsx (HR's own view) and
// app/attendance/page.tsx (employee's read-only shared view), so the
// two never drift on what a status badge looks like or how a date
// range is enumerated.

export const STATUS_DISPLAY: Record<string, { label: string; className: string }> = {
  ON_TIME: { label: "On Time", className: "bg-emerald-50 text-emerald-700" },
  LATE_COMING: { label: "Late Coming", className: "bg-amber-50 text-amber-700" },
  HALF_DAY: { label: "Half Day", className: "bg-orange-100 text-orange-700" },
  ABSENT: { label: "Absent", className: "bg-red-50 text-red-700" }
};

export const STATUS_DOT: Record<string, string> = {
  ON_TIME: "bg-emerald-500",
  LATE_COMING: "bg-amber-500",
  HALF_DAY: "bg-orange-500",
  ABSENT: "bg-red-500"
};

export function dateRangeArray(from: string, to: string): string[] {
  const dates: string[] = [];
  const cur = new Date(from);
  const end = new Date(to);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}
