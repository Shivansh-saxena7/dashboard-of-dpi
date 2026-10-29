// Positive-history junk (2026-10-29): leads the system junked although someone once had a real
// conversation with them. Rows come from get_positive_junk_leads (DB); this file only filters,
// sorts and words them. Pure functions, known-answer tested in scripts/check-positive-junk.js.

export type PositiveKind = "BOOKING" | "VISIT" | "CONVERTED" | "FOLLOW_UP" | "CONNECTED";

export interface PositiveJunkRow {
  lead_id: string;
  lead_id8: string;
  card_type: "LEAD" | "DATA";
  project: string | null;
  stage_at_junk: string;
  highest_positive: PositiveKind;
  restore_status: string;
  restore_stage: string;
  first_positive: string | null;
  first_positive_at: string | null;
  first_positive_by: string | null;
  first_positive_by_name: string | null;
  last_owner_id: string | null;
  last_owner_name: string | null;
  recycle_count: number;
  junked_at: string;
  junked_by: string;
  junk_reason: string;
  last_activity_at: string | null;
  not_interested_count: number;
  is_data_copy: boolean;
  sibling: { holder_id8: string; holder_owner_id: string; owner_name: string; stage: string } | null;
  restored_before: number;
}

export interface PositiveJunkData {
  protection_days: number;
  max_batch: number;
  employees: { id: string; name: string }[];
  rows: PositiveJunkRow[];
}

export interface RestoreResult {
  lead_id: string;
  lead_id8: string;
  employee_id: string;
  employee_name: string | null;
  result: "RESTORED" | "WOULD_RESTORE" | "HELD" | "REFUSED" | "ERROR";
  why?: string;
  to_status?: string;
  to_stage?: string;
  sibling?: { holder_id8: string; owner_name: string; stage: string } | null;
}

export const POSITIVE_ORDER: PositiveKind[] = ["BOOKING", "VISIT", "CONVERTED", "FOLLOW_UP", "CONNECTED"];

export type ActivityAge = "" | "LT7" | "7TO14" | "14TO30" | "30PLUS" | "NONE";

export interface PositiveJunkFilters {
  search: string;
  cardType: "" | "LEAD" | "DATA";
  highest: "" | PositiveKind;
  stageAtJunk: string;
  firstBy: string;
  lastOwner: string;
  junkFrom: string; // YYYY-MM-DD (IST day), inclusive
  junkTo: string;
  activityAge: ActivityAge;
  junkedBy: string;
  recycleCount: string;
  project: string;
  sibling: "" | "YES" | "NO";
}

export const EMPTY_FILTERS: PositiveJunkFilters = {
  search: "", cardType: "", highest: "", stageAtJunk: "", firstBy: "", lastOwner: "", junkFrom: "", junkTo: "",
  activityAge: "", junkedBy: "", recycleCount: "", project: "", sibling: ""
};

export type SortKey = "junked_desc" | "junked_asc" | "positive" | "activity_recent" | "first_positive_desc";

const DAY = 24 * 60 * 60 * 1000;

export function daysAgo(iso: string | null, now: number): number | null {
  if (!iso) return null;
  return Math.floor((now - new Date(iso).getTime()) / DAY);
}

export function istDay(iso: string): string {
  return new Date(new Date(iso).getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function activityAgeOf(row: PositiveJunkRow, now: number): ActivityAge {
  const d = daysAgo(row.last_activity_at, now);
  if (d === null) return "NONE";
  if (d < 7) return "LT7";
  if (d < 14) return "7TO14";
  if (d < 30) return "14TO30";
  return "30PLUS";
}

export function filterRows(rows: PositiveJunkRow[], f: PositiveJunkFilters, now: number): PositiveJunkRow[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (q && !r.lead_id8.toLowerCase().startsWith(q) && !r.lead_id.toLowerCase().startsWith(q)) return false;
    if (f.cardType && r.card_type !== f.cardType) return false;
    if (f.highest && r.highest_positive !== f.highest) return false;
    if (f.stageAtJunk && r.stage_at_junk !== f.stageAtJunk) return false;
    if (f.firstBy && (r.first_positive_by ?? "") !== f.firstBy) return false;
    if (f.lastOwner && (r.last_owner_id ?? "") !== f.lastOwner) return false;
    if (f.junkFrom && istDay(r.junked_at) < f.junkFrom) return false;
    if (f.junkTo && istDay(r.junked_at) > f.junkTo) return false;
    if (f.activityAge) {
      const age = activityAgeOf(r, now);
      // "30+" also covers leads with no recorded activity at all
      if (f.activityAge === "30PLUS" ? !(age === "30PLUS" || age === "NONE") : age !== f.activityAge) return false;
    }
    if (f.junkedBy && r.junked_by !== f.junkedBy) return false;
    if (f.recycleCount && String(r.recycle_count) !== f.recycleCount) return false;
    if (f.project && (r.project ?? "") !== f.project) return false;
    if (f.sibling === "YES" && !r.sibling) return false;
    if (f.sibling === "NO" && r.sibling) return false;
    return true;
  });
}

export function sortRows(rows: PositiveJunkRow[], key: SortKey): PositiveJunkRow[] {
  const t = (s: string | null) => (s ? new Date(s).getTime() : 0);
  const out = [...rows];
  switch (key) {
    case "junked_asc":
      return out.sort((a, b) => t(a.junked_at) - t(b.junked_at));
    case "positive":
      return out.sort((a, b) => POSITIVE_ORDER.indexOf(a.highest_positive) - POSITIVE_ORDER.indexOf(b.highest_positive) || t(b.junked_at) - t(a.junked_at));
    case "activity_recent":
      return out.sort((a, b) => t(b.last_activity_at) - t(a.last_activity_at));
    case "first_positive_desc":
      return out.sort((a, b) => t(b.first_positive_at) - t(a.first_positive_at));
    default:
      return out.sort((a, b) => t(b.junked_at) - t(a.junked_at));
  }
}

// Who to give the lead back to by default: the employee who first had the positive conversation,
// if still active; otherwise nobody (the admin must pick).
export function suggestedEmployee(row: PositiveJunkRow, activeIds: Set<string>): string {
  return row.first_positive_by && activeIds.has(row.first_positive_by) ? row.first_positive_by : "";
}

// A lead can be selected only when the server would ever restore it.
export function selectable(row: PositiveJunkRow): boolean {
  return !row.is_data_copy;
}

const LABEL: Record<string, string> = {
  BOOKING: "Booking", VISIT: "Visit", CONVERTED: "Converted", FOLLOW_UP: "Follow-up", CONNECTED: "Connected",
  LEADS: "Leads", NEW: "New", NOT_CONNECTED: "Not connected", NOT_INTERESTED: "Not interested", SWITCHED_OFF: "Switched off"
};

export function label(code: string | null | undefined): string {
  if (!code) return "—";
  return LABEL[code] ?? code.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

// "Converted · Follow-up" — what the lead comes back as.
export function restoreTarget(status: string, stage: string): string {
  return stage && stage !== "LEADS" ? `${label(status)} · ${label(stage)}` : label(status);
}

export function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "2-digit" });
}
