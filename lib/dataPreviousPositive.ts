import { shortDate } from "./givenLeadContext";
import { label } from "./positiveJunk";

// "Previously connected" on the employee Data page (2026-11-04). Rows come from get_data_previous_positive (DB), which owns
// who qualifies and carries no name, number or note. Pure functions, known-answer tested in scripts/check-data-previous-positive.js.

export interface DataPreviousPositive {
  lead_id: string;
  last_positive: { kind: string; at: string; is_you: boolean };
  after: { outcome: string; at: string } | null;
}

export const PREVIOUS_POSITIVE_CACHE_MS = 5 * 60 * 1000;

export interface PreviousPositiveCache {
  at: number;
  leads: DataPreviousPositive[];
}

export function readPreviousPositiveCache(raw: string | null | undefined, nowMs: number): PreviousPositiveCache | null {
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw) as PreviousPositiveCache;
    return typeof entry.at === "number" && Array.isArray(entry.leads) && nowMs - entry.at < PREVIOUS_POSITIVE_CACHE_MS ? entry : null;
  } catch {
    return null;
  }
}

export function previousPositiveByLeadId(rows: DataPreviousPositive[] | null | undefined): Map<string, DataPreviousPositive> {
  return new Map((rows ?? []).map((row) => [row.lead_id, row]));
}

export function previousPositiveText(row: DataPreviousPositive): { lastPositive: string; after: string | null } {
  const who = row.last_positive.is_you ? "you" : "a team member";
  return {
    lastPositive: `Last positive conversation: ${label(row.last_positive.kind)}, ${shortDate(row.last_positive.at)}, by ${who}`,
    after: row.after ? `After that: ${label(row.after.outcome)}, ${shortDate(row.after.at)}` : null
  };
}
