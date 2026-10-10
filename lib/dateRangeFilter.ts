import { istDateStringToRangeStartUTC, istDateStringToRangeEndUTC } from "./istTime.ts";

export type DateRangeOption = "ALL" | "THIS_WEEK" | "THIS_MONTH" | "CUSTOM";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

// Extracted from LeadList.tsx's original inline logic. THIS_WEEK /
// THIS_MONTH are rolling windows from now (labelled "Last 7 days" /
// "Last 30 days" since 2026-10-10), not calendar weeks or months.
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

  if (option === "CUSTOM" && (customStart || customEnd)) {
    // IST-aware boundaries (2026-10-01 fix) -- see istTime.ts's own
    // comment for why plain `new Date(customStart)` was wrong here.
    // Either end may be left empty (open-ended range, 2026-10-10).
    const startMs = customStart ? istDateStringToRangeStartUTC(customStart).getTime() : -Infinity;
    const endMs = customEnd ? istDateStringToRangeEndUTC(customEnd).getTime() : Infinity;
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
  if (option === "THIS_WEEK") return "Last 7 days";
  if (option === "THIS_MONTH") return "Last 30 days";
  if (option === "CUSTOM" && customStart && customEnd) return `${customStart} to ${customEnd}`;
  if (option === "CUSTOM" && customStart) return `From ${customStart}`;
  if (option === "CUSTOM" && customEnd) return `Up to ${customEnd}`;
  return null;
}
