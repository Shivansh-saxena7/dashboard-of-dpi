// Lead Journey tab of the Performance Report (2026-11-26, definitions v3). Pure helpers: words, %, team average, low
// sample, the flat journey rows used by the page and the Excel file. No imports (scripts/check-admin-report.js runs this
// file on its own). The numbers come from get_perf_journey (SQL: supabase/sql/2026-11-26_perf_lead_journey.sql).

export const JOURNEY_LOW_SAMPLE = 20;
export const JOURNEY_PAGE = 200;
export const JOURNEY_EXCEL_PAGE = 500;
export const JOURNEY_EXCEL_MAX = 20000;
export const JOURNEY_OWNERS_FLAT = 4;
export const FAIR_NOTE = "A signal, not a verdict.";
export const EFFORT_NOTE = "Calls and first action are approx: not every call is logged.";

export type JourneyCountKey = "leads" | "positive" | "missed" | "not_counted" | "won" | "assist";
export type JourneyView = "all" | "missed" | "won" | "assist" | "positive" | "moved_no_pos" | "not_counted";

export interface JourneyEmpRow {
  employee_id: string;
  name: string | null;
  active?: boolean | null;
  leads: number;
  assignments: number;
  fresh?: number;
  recycled?: number;
  positive: number;
  moved_no_pos: number;
  missed: number;
  not_counted: number;
  won: number;
  assist: number;
  calls_avg: number | null;
  first_action_h: number | null;
  days_held_avg?: number | null;
  low_sample?: boolean;
  pct?: Partial<Record<string, number | null>>;
}
export type JourneyTeam = Omit<JourneyEmpRow, "employee_id" | "name"> & { distinct_leads?: number };
export interface JourneyStep {
  seq: number;
  employee_id: string;
  name: string | null;
  origin: string;
  assigned_at: string;
  ended_at: string | null;
  days: number | null;
  calls: number;
  worked: boolean;
  positive: boolean;
  result: string;
  move: string | null;
  excused: string | null;
  in_range: boolean;
  missed: boolean;
  won: boolean;
  assist: boolean;
}
export interface JourneyRow {
  lead_id: string;
  lead_short: string;
  first_at: string;
  lead_type: string | null;
  source: string | null;
  project: string | null;
  status: string | null;
  stage: string | null;
  available: boolean;
  positive_now: boolean;
  got_by: string | null;
  got_by_name: string | null;
  owners: number;
  steps: JourneyStep[];
}
export interface JourneyPage { view: JourneyView; employee_id: string | null; total: number; rows: JourneyRow[] }
export interface JourneyReport {
  api: string;
  def_version: number;
  from: string;
  to: string;
  today: string;
  as_of: string | null;
  by_employee: JourneyEmpRow[];
  team: JourneyTeam;
  journeys: JourneyPage;
  definitions: { key: string; label: string; rule: string }[];
  options: { employees: { id: string; name: string | null; active: boolean | null }[]; sources: string[] };
}

export const COUNT_LABEL: Record<JourneyCountKey, string> = {
  leads: "Leads given", positive: "Positive with them", missed: "Missed by me", not_counted: "Moved, not counted", won: "Won from others", assist: "Assists"
};
// Each count's drill-down view and its definition key.
export const COUNT_VIEW: Record<JourneyCountKey, JourneyView> = { leads: "all", positive: "positive", missed: "missed", not_counted: "not_counted", won: "won", assist: "assist" };
export const COUNT_DEF: Record<JourneyCountKey, string> = {
  leads: "journey_range", positive: "journey_positive", missed: "journey_missed", not_counted: "journey_not_counted", won: "journey_won", assist: "journey_assist"
};
export const PCT_KEYS: JourneyCountKey[] = ["missed", "won", "assist"];
export const VIEWS: { v: JourneyView; l: string }[] = [
  { v: "all", l: "All" }, { v: "missed", l: "Missed by me" }, { v: "won", l: "Won from others" }, { v: "assist", l: "Assists" }, { v: "not_counted", l: "Moved, not counted" }
];
export const viewLabel = (v: JourneyView) => VIEWS.find((x) => x.v === v)?.l ?? (v === "positive" ? "Positive" : v === "moved_no_pos" ? "Moved on, no positive" : "All");

const num = (x: unknown) => Number(x ?? 0) || 0;
// % of leads given, one decimal, never over 100, "–" when nothing was given.
export function jPct(count: unknown, leads: unknown): string {
  const l = num(leads);
  if (l <= 0) return "–";
  return `${Math.min(100, Math.round((1000 * num(count)) / l) / 10).toFixed(1)}%`;
}
export const lowSample = (r: { leads: unknown }) => num(r.leads) < JOURNEY_LOW_SAMPLE;
// Team average missed %: all missed / all leads given (the team row), the same for every row.
export const teamAvg = (team: Partial<JourneyTeam> | null | undefined, k: JourneyCountKey = "missed") => jPct(team?.[k], team?.leads);

const RESULT: Record<string, string> = {
  NO_RESULT: "No result", NOT_CONNECTED: "Not connected", SWITCHED_OFF: "Switched off", NOT_INTERESTED: "Not interested", CONNECTED: "Connected",
  CONVERTED: "Converted", FOLLOWUP: "Follow-up", VISIT: "Visit", BOOKED: "Booking", JUNK: "Junk"
};
const title = (k: string) => k.toLowerCase().split("_").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
export const resultWord = (k: string | null | undefined) => (k ? RESULT[k] ?? title(k) : "No result");
const MOVE: Record<string, string> = { system: "Recycled", admin: "Given by admin", restore: "Given back", other: "Moved" };
export const moveWord = (k: string | null | undefined) => (k ? MOVE[k] ?? title(k) : "Still with them");
const ORIGIN: Record<string, string> = { FRESH: "Fresh", RECYCLED: "Recycled", RESTORED: "Given back", ADMIN_GIVEN: "Given by admin", SELF: "Own lead", OTHER: "Other" };
export const originWordJ = (k: string | null | undefined) => (k ? ORIGIN[k] ?? title(k) : "–");
export const excusedWord = (k: string | null | undefined) => (k === "leave" ? "On leave" : k === "inactive" ? "Inactive" : "");
export const typeWord = (k: string | null | undefined) => (k === "DATA" ? "Data" : k === "LEAD" ? "Lead" : k ?? "–");
export const dayCount = (d: number | null | undefined) => (d == null ? "–" : `${Math.round(Number(d))}d`);
export const hoursText = (h: number | null | undefined) => (h == null ? "–" : h < 24 ? `${Number(h).toFixed(1)} h` : `${(Number(h) / 24).toFixed(1)} d`);

// One step as short text: "Name · Result · 2 calls · 5d" (+ leave / inactive).
export function stepText(s: JourneyStep): string {
  const parts = [s.name ?? s.employee_id.slice(0, 8), resultWord(s.result), `${s.calls} call${s.calls === 1 ? "" : "s"}`, dayCount(s.days)];
  const ex = excusedWord(s.excused);
  if (ex) parts.push(ex);
  return parts.join(" · ");
}
// Final outcome: the lead's stage / status today.
export function outcomeText(r: JourneyRow): string {
  if (!r.available) return r.status === "JUNK" ? "Junk" : "Merged";
  const stage = r.stage && r.stage !== "LEADS" ? title(r.stage).replace("Follow Up", "Follow-up") : null;
  return stage ?? resultWord(r.status === "NEW" ? "NO_RESULT" : r.status);
}
// Who it went to in the end (the last positive owner), or "–".
export const gotByText = (r: JourneyRow) => (r.got_by ? r.got_by_name ?? r.got_by.slice(0, 8) : "–");

// Flat rows for the Excel "Journeys" sheet: Owner 1..4 (name, result, calls, days), more owners, outcome, who got it,
// and who missed / won / assisted it in the range. Plain text and numbers only (no formulas).
export const FLAT_HEAD = (() => {
  const h = ["Lead", "Source", "Lead / Data", "First given"];
  for (let i = 1; i <= JOURNEY_OWNERS_FLAT; i++) h.push(`Owner ${i}`, `Owner ${i} came as`, `Owner ${i} result`, `Owner ${i} calls (approx)`, `Owner ${i} days`, `Owner ${i} moved by`);
  h.push("More owners", "Final outcome", "Got it", "Missed by", "Won by", "Assist by");
  return h;
})();
const safe = (v: unknown): string | number => {
  if (typeof v === "number") return v;
  const s = String(v ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};
export function flatJourney(r: JourneyRow): (string | number)[] {
  const out: (string | number)[] = [r.lead_short, r.source ?? "–", typeWord(r.lead_type), (r.first_at ?? "").slice(0, 10)];
  for (let i = 0; i < JOURNEY_OWNERS_FLAT; i++) {
    const s = r.steps[i];
    if (!s) out.push("", "", "", "", "", "");
    else out.push(s.name ?? s.employee_id.slice(0, 8), originWordJ(s.origin), resultWord(s.result), s.calls, s.days == null ? "" : Math.round(Number(s.days)), s.ended_at ? [moveWord(s.move), excusedWord(s.excused)].filter(Boolean).join(", ") : "Still with them");
  }
  const who = (f: "missed" | "won" | "assist") => [...new Set(r.steps.filter((s) => s.in_range && s[f]).map((s) => s.name ?? s.employee_id.slice(0, 8)))].join(", ");
  out.push(Math.max(0, r.owners - JOURNEY_OWNERS_FLAT), outcomeText(r), gotByText(r), who("missed"), who("won"), who("assist"));
  return out.map(safe);
}
// Summary sheet / table: counts first, every % at the end.
export const SUMMARY_HEAD = ["Employee", "Leads given", "Assignments", "Positive with them", "Moved on, no positive", "Missed by me", "Moved, not counted",
  "Won from others", "Assists", "Calls / lead (approx)", "First action (approx)", "Note", "Missed %", "Team avg missed %", "Won %", "Assist %"];
export function summaryRow(name: string, r: Partial<JourneyEmpRow>, team: Partial<JourneyTeam> | null, isTeam = false): (string | number)[] {
  return [name, num(r.leads), num(r.assignments), num(r.positive), num(r.moved_no_pos), num(r.missed), num(r.not_counted), num(r.won), num(r.assist),
    r.calls_avg == null ? "–" : Number(r.calls_avg), hoursText(r.first_action_h), !isTeam && lowSample({ leads: r.leads }) ? "Low sample" : "",
    jPct(r.missed, r.leads), teamAvg(team), jPct(r.won, r.leads), jPct(r.assist, r.leads)].map(safe);
}
// Rows of one employee's sheet: the journeys where they had an assignment in the range.
export const rowsOf = (rows: JourneyRow[], employeeId: string) => rows.filter((r) => r.steps.some((s) => s.in_range && s.employee_id === employeeId));
// Excel sheet names: 31 chars, no []:*?/\ , unique.
export function sheetName(name: string, used: Set<string>): string {
  const base = (name.replace(/[[\]:*?/\\]/g, " ").trim() || "Employee").slice(0, 28);
  let s = base, i = 2;
  while (used.has(s.toLowerCase())) s = `${base.slice(0, 26)} ${i++}`;
  used.add(s.toLowerCase());
  return s;
}
