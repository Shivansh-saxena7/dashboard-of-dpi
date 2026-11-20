// Admin Performance Report (2026-11-20): pure helpers shared by the page, the tests and scripts/check-admin-report.js.
// Every number comes from get_perf_report (definitions v1, per assignment, distinct leads); this file only formats.

export interface MetricRow {
  leads: number;
  stints: number;
  fresh: number;
  recycled: number;
  restored: number;
  admin_given: number;
  other: number;
  followup: number;
  visit: number;
  visit_verified: number;
  booked: number;
  converted: number;
  details_est: number;
  not_connected: number;
  not_interested: number;
  no_result: number;
  calls: number;
  pct?: Record<string, number | null> | null;
  status_mix?: Record<string, number> | null;
  status_pct?: Record<string, number | null> | null;
  stage_mix?: Record<string, number> | null;
  stage_pct?: Record<string, number | null> | null;
}
export interface PerfReport {
  def_version: number;
  as_of: string | null;
  from: string;
  to: string;
  totals: Partial<MetricRow>;
  by_employee: (Partial<MetricRow> & { employee_id: string; name: string | null })[];
  by_source: (Partial<MetricRow> & { source: string })[];
  by_employee_type: (Partial<MetricRow> & { employee_id: string; lead_type: string | null })[];
  options: { employees: { id: string; name: string | null }[]; teams: { id: string; name: string | null }[]; sources: string[]; projects: string[] } | null;
  definitions: { key: string; label: string; rule: string }[];
}

export type MetricKey =
  | "leads" | "fresh" | "recycled" | "restored" | "admin_given" | "other" | "followup" | "visit" | "visit_verified"
  | "booked" | "converted" | "details_est" | "not_connected" | "not_interested" | "no_result";

// Column order for every table and the CSV. "def" = the perf_definitions key for the "i" popup.
export const METRICS: { key: MetricKey; label: string; short: string; def: string }[] = [
  { key: "leads", label: "Leads received", short: "Leads", def: "leads" },
  { key: "fresh", label: "Fresh", short: "Fresh", def: "fresh" },
  { key: "recycled", label: "Recycled", short: "Recycled", def: "recycled" },
  { key: "restored", label: "Given back", short: "Given back", def: "restored" },
  { key: "admin_given", label: "Given by admin", short: "By admin", def: "admin_given" },
  { key: "followup", label: "Follow-up", short: "Follow-up", def: "followup" },
  { key: "visit", label: "Visits", short: "Visits", def: "visit" },
  { key: "visit_verified", label: "Verified visits", short: "Verified", def: "visit_verified" },
  { key: "booked", label: "Bookings", short: "Booked", def: "booked" },
  { key: "converted", label: "Converted", short: "Converted", def: "converted" },
  { key: "details_est", label: "Details sent, no visit", short: "Details (est.)", def: "details_est" },
  { key: "not_connected", label: "Not connected", short: "Not conn.", def: "not_connected" },
  { key: "not_interested", label: "Not interested", short: "Not int.", def: "not_interested" },
  { key: "no_result", label: "No result", short: "No result", def: "status_mix" }
];
// The ten summary tiles (design.md).
export const TILE_KEYS: MetricKey[] = ["leads", "fresh", "recycled", "followup", "visit", "converted", "booked", "details_est", "not_connected", "not_interested"];
export const SOURCE_KEYS: MetricKey[] = ["leads", "fresh", "recycled", "followup", "visit", "booked", "converted", "not_connected", "not_interested"];

export const n = (r: Partial<MetricRow> | null | undefined, k: MetricKey): number => Number((r as Record<string, unknown> | undefined)?.[k] ?? 0) || 0;

// % of the row's leads, one decimal; "–" when the row has no leads (never divides by zero).
export function pctText(count: number, leads: number): string {
  if (!leads || !Number.isFinite(leads) || leads <= 0) return "–";
  return `${(Math.round((1000 * count) / leads) / 10).toFixed(1)}%`;
}
export function metricPct(r: Partial<MetricRow> | null | undefined, k: MetricKey): string {
  if (k === "leads") return n(r, "leads") > 0 ? "100.0%" : "–";
  return pctText(n(r, k), n(r, "leads"));
}

// Human words for a status / stage key. Known ones get fixed words; a new key shows under its own name.
const STATUS_WORDS: Record<string, string> = {
  NOT_CONNECTED: "Not connected", SWITCHED_OFF: "Switched off", NOT_INTERESTED: "Not interested", CONNECTED: "Connected",
  CONVERTED: "Converted", NO_RESULT: "No result"
};
const STAGE_WORDS: Record<string, string> = { LEADS: "Leads (no move)", FOLLOW_UP: "Follow-up", VISIT: "Visit", BOOKING: "Booking" };
const titleCase = (k: string) => k.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
export const statusWord = (k: string) => STATUS_WORDS[k] ?? titleCase(k);
export const stageWord = (k: string) => STAGE_WORDS[k] ?? titleCase(k);
export type Tone = "red" | "amber" | "green" | "blue" | "mute";
export function statusTone(k: string): { tone: Tone; icon: string } {
  if (k === "NOT_CONNECTED" || k === "SWITCHED_OFF") return { tone: "red", icon: "✕" };
  if (k === "NOT_INTERESTED") return { tone: "amber", icon: "▲" };
  if (k === "CONNECTED" || k === "CONVERTED") return { tone: "green", icon: "✓" };
  if (k === "NO_RESULT") return { tone: "mute", icon: "–" };
  return { tone: "blue", icon: "◆" };
}

// Mix columns from the data itself: known keys in a fixed order first, then any new key alphabetically.
const STATUS_ORDER = ["CONNECTED", "CONVERTED", "NOT_CONNECTED", "SWITCHED_OFF", "NOT_INTERESTED", "NO_RESULT"];
const STAGE_ORDER = ["LEADS", "FOLLOW_UP", "VISIT", "BOOKING"];
export function mixKeys(rows: (Partial<MetricRow> | null | undefined)[], field: "status_mix" | "stage_mix"): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r?.[field] ?? {})) seen.add(k);
  const order = field === "status_mix" ? STATUS_ORDER : STAGE_ORDER;
  const known = order.filter((k) => seen.has(k));
  const extra = [...seen].filter((k) => !order.includes(k)).sort();
  return [...known, ...extra];
}
export function mixPct(r: Partial<MetricRow> | null | undefined, field: "status_mix" | "stage_mix", key: string): string {
  return pctText(Number(r?.[field]?.[key] ?? 0), n(r, "leads"));
}

// Date presets in India time. Returns YYYY-MM-DD strings (the RPC takes IST days).
export type Preset = "today" | "last7" | "this_month" | "last_month" | "custom";
const istYmd = (ms: number) => new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10);
export function presetRange(p: Exclude<Preset, "custom">, nowMs: number): { from: string; to: string } {
  const today = istYmd(nowMs);
  if (p === "today") return { from: today, to: today };
  if (p === "last7") return { from: istYmd(nowMs - 6 * 86400e3), to: today };
  const [y, m] = today.split("-").map(Number);
  if (p === "this_month") return { from: `${today.slice(0, 7)}-01`, to: today };
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const mm = String(pm).padStart(2, "0");
  return { from: `${py}-${mm}-01`, to: `${py}-${mm}-${String(last).padStart(2, "0")}` };
}
export function rangeText(from: string, to: string): string {
  const f = (s: string, withMonth: boolean) => new Date(`${s}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: withMonth ? "short" : undefined, timeZone: "UTC" });
  if (from === to) return f(from, true);
  return from.slice(0, 7) === to.slice(0, 7) ? `${f(from, false)}–${f(to, true)}` : `${f(from, true)} – ${f(to, true)}`;
}

export interface Filters {
  employee: string;
  team: string;
  source: string;
  project: string;
  leadType: "" | "LEAD" | "DATA";
  origin: string;
}
export const NO_FILTERS: Filters = { employee: "", team: "", source: "", project: "", leadType: "", origin: "" };
export function filtersJson(f: Filters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (f.employee) out.employee_ids = [f.employee];
  if (f.team) out.team_ids = [f.team];
  if (f.source) out.sources = [f.source];
  if (f.project) out.projects = [f.project];
  if (f.leadType) out.lead_type = f.leadType;
  if (f.origin) out.origins = f.origin === "OTHER" ? ["SELF", "OTHER"] : [f.origin];
  return out;
}

// CSV: count and % for every metric; then the status and stage mixes. Quotes every text cell.
const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s;
};
export function buildCsv(r: PerfReport, nameOf: (id: string) => string): string {
  const lines: string[] = [];
  const head = (first: string) => [first, ...METRICS.flatMap((m) => (m.key === "leads" ? [m.label] : [m.label, `${m.label} %`]))].map(cell).join(",");
  const row = (label: string, x: Partial<MetricRow>) => [label, ...METRICS.flatMap((m) => (m.key === "leads" ? [n(x, "leads")] : [n(x, m.key), metricPct(x, m.key)]))].map(cell).join(",");
  lines.push(cell(`Performance report ${r.from} to ${r.to} (definitions v${r.def_version}, as of ${r.as_of ?? "not built"})`));
  lines.push("", head("Employee"));
  for (const e of r.by_employee) lines.push(row(e.name ?? nameOf(e.employee_id), e));
  lines.push(row("Total", r.totals));
  lines.push("", head("Source"));
  for (const s of r.by_source) lines.push(row(s.source, s));
  for (const [field, title, word] of [["status_mix", "Status", statusWord], ["stage_mix", "Stage", stageWord]] as const) {
    const keys = mixKeys([r.totals, ...r.by_employee], field);
    lines.push("", [`${title} mix: employee`, "Leads", ...keys.flatMap((k) => [word(k), `${word(k)} %`])].map(cell).join(","));
    for (const e of [...r.by_employee, { ...r.totals, name: "Total", employee_id: "" }])
      lines.push([e.name ?? nameOf(e.employee_id), n(e, "leads"), ...keys.flatMap((k) => [Number(e[field]?.[k] ?? 0), mixPct(e, field, k)])].map(cell).join(","));
  }
  return lines.join("\n") + "\n";
}

export function asOfText(iso: string | null): string {
  if (!iso) return "Not built yet";
  const d = new Date(iso);
  return `As of ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}, ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}`;
}

// Drill-down metric for a mix cell.
export const mixMetric = (field: "status_mix" | "stage_mix", key: string) => `${field === "status_mix" ? "status" : "stage"}:${key}`;
