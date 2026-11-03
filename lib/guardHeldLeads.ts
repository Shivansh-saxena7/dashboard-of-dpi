// Leads the positive-history junk guard is holding back (2026-11-03). Rows come from get_guard_held_leads (DB), which owns
// who qualifies; this file only words them. Pure functions, known-answer tested in scripts/check-guard-held.js.

export interface GuardHeldLead {
  lead_id8: string;
  lead_name: string | null;
  owner_name: string | null;
  recycle_count: number;
  positive_kind: string;
  last_activity_at: string | null;
  first_refused_at: string;
  last_refused_at: string;
  days_refused: number;
}

// The function is not there yet or the caller may not use it: the card stays hidden, nothing is logged as an error.
export function guardHeldUnavailable(error: { code?: string | null } | null | undefined): boolean {
  return ["PGRST202", "42501", "42883"].includes(error?.code ?? "");
}

const POSITIVE_LABELS: Record<string, string> = {
  CONNECTED: "Connected",
  CONVERTED: "Converted",
  FOLLOW_UP: "Follow-up",
  VISIT: "Visit",
  BOOKING: "Booking"
};

export function positiveLabel(kind: string | null | undefined): string {
  return (kind && POSITIVE_LABELS[kind]) || kind || "-";
}

export function refusedForText(days: number | null | undefined): string {
  const d = Math.max(0, Math.floor(days ?? 0));
  if (d === 0) return "Today";
  return d === 1 ? "1 day" : `${d} days`;
}

export function shortDateIst(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const part = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-US", { timeZone: "Asia/Kolkata", ...o });
  return `${part({ day: "numeric" })} ${part({ month: "short" })}`;
}
