import { label } from "./positiveJunk";

// "Given by admin" (2026-11-02). Leads an admin gave back to an employee, from get_given_lead_context
// (DB). The database owns who qualifies and in_filter; this file only reads and words its rows, so the
// filter count, the filter list and any later Home tile all come from one place. Pure functions,
// known-answer tested in scripts/check-given-context.js. No employee names exist in this data.

export const GIVEN_BY_ADMIN_FILTER = "GIVEN_BY_ADMIN";

export interface GivenLeadContext {
  lead_id: string;
  lead_type: string;
  given_at: string;
  protected_until: string;
  in_filter: boolean;
  last_positive: { kind: string; at: string; is_you: boolean } | null;
  note: { text: string; at: string; match: "exact" | "other_time" } | null;
  after: { outcome: string; at: string } | null;
  your_notes: { at: string; note: string; outcome: string | null }[];
}

export function contextByLeadId(rows: GivenLeadContext[] | null | undefined): Map<string, GivenLeadContext> {
  return new Map((rows ?? []).map((row) => [row.lead_id, row]));
}

export function givenFilterLeads<T extends { id: string }>(leads: T[], byLeadId: Map<string, GivenLeadContext>): T[] {
  return leads.filter((lead) => byLeadId.get(lead.id)?.in_filter === true);
}

export function givenFilterCount(leads: { id: string }[], byLeadId: Map<string, GivenLeadContext>): number {
  return givenFilterLeads(leads, byLeadId).length;
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  const part = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-US", { timeZone: "Asia/Kolkata", ...o });
  return `${part({ day: "numeric" })} ${part({ month: "short" })}`;
}

export interface GivenBoxText {
  lastPositive: string;
  note: string | null;
  after: string | null;
  protectedUntil: string;
  yourNotes: string[];
}

export function givenBoxText(context: GivenLeadContext): GivenBoxText {
  const positive = context.last_positive;
  const note = context.note;
  return {
    lastPositive: positive
      ? `Last positive conversation: ${label(positive.kind)}, ${shortDate(positive.at)}${positive.is_you ? ", by you" : ""}`
      : "No earlier positive conversation was found.",
    note: !positive
      ? null
      : !note
        ? "No note was saved with this conversation."
        : note.match === "exact"
          ? `Note: "${note.text}"`
          : `Note (${shortDate(note.at)}): "${note.text}"`,
    after: context.after ? `After that: ${label(context.after.outcome)}, ${shortDate(context.after.at)}` : null,
    protectedUntil: `Protected until ${shortDate(context.protected_until)}`,
    yourNotes: (context.your_notes ?? []).map((n) => [shortDate(n.at), n.outcome ? label(n.outcome) : null, n.note].filter(Boolean).join(" · "))
  };
}

export function givenBoxVisible(context: GivenLeadContext | null | undefined, nowMs: number = Date.now()): boolean {
  return Boolean(context) && Date.parse(context!.protected_until) > nowMs;
}
