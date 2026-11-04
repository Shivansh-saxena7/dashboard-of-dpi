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

export const HELD_REASSIGN_REASON = "Reassigned by admin: held by the positive-history guard";

// The card holds only the short lead id. A uuid range finds the one lead with that prefix, with no DB change.
export function heldLeadIdRange(id8: string): { from: string; to: string } | null {
  if (!/^[0-9a-f]{8}$/.test(id8)) return null;
  return { from: `${id8}-0000-0000-0000-000000000000`, to: `${id8}-ffff-ffff-ffff-ffffffffffff` };
}

export interface ReassignEmployee {
  id: string;
  name: string | null;
  role?: string | null;
  department?: string | null;
  is_active?: boolean | null;
}

// Who the dialog offers: active sales staff who take leads, not the current owner. The database checks again.
export function heldReassignTargets(employees: ReassignEmployee[], ownerId: string | null | undefined): ReassignEmployee[] {
  return employees
    .filter((e) => e.is_active === true && e.department === "sales" && (e.role === "employee" || e.role === "team_leader") && e.id !== ownerId)
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

export interface HeldReassignOutcome {
  ok: boolean;
  message: string;
}

// What reassign_keep_state_atomic answered, in plain words. Never shows who holds a sibling or any number.
export function heldReassignOutcome(
  data: { result?: string | null; employee_name?: string | null } | null | undefined,
  error: { code?: string | null; message?: string | null } | null | undefined
): HeldReassignOutcome {
  if (error) {
    const text = error.message ?? "";
    if (error.code === "SESSION_EXPIRED") return { ok: false, message: text };
    if (text.includes("admin only") || error.code === "42501") return { ok: false, message: "Only an admin can reassign this lead." };
    if (text.includes("junk or merged")) return { ok: false, message: "This lead has been junked or merged. Please refresh the list." };
    if (text.includes("not an active sales employee")) return { ok: false, message: "This employee cannot take leads. Please choose someone else." };
    if (text.includes("no active assignment")) return { ok: false, message: "This lead has no active owner. Please refresh the list." };
    return { ok: false, message: "Could not reassign this lead. Please try again." };
  }
  const name = data?.employee_name?.trim();
  if (data?.result === "REASSIGNED") return { ok: true, message: name ? `Lead reassigned to ${name}.` : "Lead reassigned." };
  if (data?.result === "ALREADY") return { ok: true, message: name ? `This lead is already with ${name}.` : "This lead is already with that employee." };
  if (data?.result === "HELD") return { ok: false, message: "This number has a positive lead with another employee, so it cannot go to this person. Please choose someone else." };
  return { ok: false, message: "Could not reassign this lead. Please try again." };
}
