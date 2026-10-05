import { getRecycleCutoff } from "./calculateSLAStatus.ts";

type SLALead = Parameters<typeof getRecycleCutoff>[0];

const DAY_MS = 24 * 60 * 60 * 1000;

// "Worth saving" (approved 2026-10-05): the lead is genuinely engaged —
// Connected, or Converted without a booking (a booked lead is terminal and
// never recycles) — or Not Connected / Switched Off after at most ONE call
// attempt by the current owner. Not Interested never qualifies, in any
// stage. Stage alone doesn't qualify a lead.
export function isWorthSaving(status: string, callCount: number): boolean {
  if (status === "CONNECTED" || status === "CONVERTED") return true;
  if (status === "NOT_CONNECTED" || status === "SWITCHED_OFF") return callCount <= 1;
  return false;
}

// The recycle cutoff when it falls within the next 24 hours AND the lead is
// worth saving, else null. Uses getRecycleCutoff — the same countdown the
// card shows and the recycle sweep follows — so a paused lead (Snooze, or
// a Visit inside its 1-month lock) has no cutoff and never qualifies; it
// enters these rules normally once the pause ends. Read-only.
export function recyclingTomorrowCutoff(
  lead: SLALead,
  lastOutcomeAt: string | null,
  callCount: number,
  isPersonalLead: boolean,
  now: number = Date.now()
): Date | null {
  if (!isWorthSaving(lead.status, callCount)) return null;
  const cutoff = getRecycleCutoff(lead, lastOutcomeAt, isPersonalLead);
  if (!cutoff) return null;
  const msLeft = cutoff.cutoffAt.getTime() - now;
  return msLeft > 0 && msLeft <= DAY_MS ? cutoff.cutoffAt : null;
}
