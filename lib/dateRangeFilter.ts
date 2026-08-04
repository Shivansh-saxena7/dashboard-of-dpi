export type DateRangeOption = "ALL" | "THIS_WEEK" | "THIS_MONTH" | "CUSTOM";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

// Extracted from LeadList.tsx's original inline logic (This Week /
// This Month are rolling windows from now, not calendar-boundary
// aware — a deliberate simplification carried over unchanged).
export function isWithinDateRange(
  isoDate: string | null | undefined,
  option: DateRangeOption,
  customStart: string,
  customEnd: string
): boolean {
  if (option === "ALL") return true;
  if (!isoDate) return false;

  const ms = new Date(isoDate).getTime();
  const nowMs = Date.now();

  if (option === "THIS_WEEK") return nowMs - ms <= WEEK_MS;
  if (option === "THIS_MONTH") return nowMs - ms <= MONTH_MS;

  if (option === "CUSTOM" && customStart && customEnd) {
    const startMs = new Date(customStart).getTime();
    const endMs = new Date(customEnd).getTime() + 24 * 60 * 60 * 1000 - 1;
    return ms >= startMs && ms <= endMs;
  }

  return true;
}

export function dateRangeFilterLabel(
  option: DateRangeOption,
  customStart: string,
  customEnd: string
): string | null {
  if (option === "ALL") return null;
  if (option === "THIS_WEEK") return "This Week";
  if (option === "THIS_MONTH") return "This Month";
  if (option === "CUSTOM" && customStart && customEnd) return `${customStart} to ${customEnd}`;
  return null;
}
