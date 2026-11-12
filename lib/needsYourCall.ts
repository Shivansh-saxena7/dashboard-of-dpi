// "Needs your call" (2026-11-12): the employee's own leads that the positive-history junk guard keeps from being junked.
// Rows come from get_my_guard_held_leads (DB), which owns who qualifies. Shared by the Leads and Data page status filters.
// Pure functions, known-answer tested in scripts/check-needs-your-call.js.

export const NEEDS_CALL_FILTER = "NEEDS_YOUR_CALL";
export const NEEDS_CALL_LABEL = "Needs your call";
export const NEEDS_CALL_CACHE_MS = 5 * 60 * 1000;

export interface NeedsCallLead {
  lead_id: string;
  positive_kind: string | null;
  last_refused_at: string;
}

export interface NeedsCallState {
  enabled: boolean;
  byLeadId: Map<string, NeedsCallLead>;
}

export interface NeedsCallHistory {
  outcome_at?: string | null;
  last_call_click_at?: string | null;
}

// The function is not there yet or not allowed: the option stays hidden and nothing is logged as an error.
export function needsCallUnavailable(error: { code?: string | null } | null | undefined): boolean {
  return ["PGRST202", "42501", "42883"].includes(error?.code ?? "");
}

export function needsCallByLeadId(rows: NeedsCallLead[] | null | undefined): Map<string, NeedsCallLead> {
  return new Map((rows ?? []).map((row) => [row.lead_id, row]));
}

export function readNeedsCallCache(raw: string | null | undefined, nowMs: number): { at: number; leads: NeedsCallLead[] } | null {
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw);
    return typeof entry?.at === "number" && Array.isArray(entry.leads) && nowMs - entry.at < NEEDS_CALL_CACHE_MS ? entry : null;
  } catch {
    return null;
  }
}

// A Call tap or a saved result after the last refusal: the employee has acted, so the lead leaves the list at once (the page
// patches outcome_at when a result is saved). A note, reminder, stage move or WhatsApp tap does not count.
export function workedSinceRefusal(history: NeedsCallHistory | null | undefined, lastRefusedAt: string): boolean {
  const refused = Date.parse(lastRefusedAt);
  if (!Number.isFinite(refused)) return false;
  const after = (iso: string | null | undefined) => Boolean(iso) && Date.parse(iso as string) > refused;
  return after(history?.outcome_at) || after(history?.last_call_click_at);
}

export function needsCallFilterLeads<T extends { id: string; lead_history?: NeedsCallHistory[] | null }>(leads: T[], byLeadId: Map<string, NeedsCallLead>): T[] {
  return leads.filter((lead) => {
    const row = byLeadId.get(lead.id);
    return Boolean(row) && !workedSinceRefusal(lead.lead_history?.[0], row!.last_refused_at);
  });
}

export function needsCallOptionText(count: number): string {
  return `${NEEDS_CALL_LABEL} (${count})`;
}
