// Admin Performance Report (2026-11-20, v2 2026-11-23): pure helpers shared by the page, the tests and
// scripts/check-admin-report.js. Every number comes from get_perf_report_v2 (or v1 when v2 is not applied yet);
// this file only formats, groups and exports.

export interface MetricRow {
  leads: number;
  stints: number;
  recycled_stints?: number;
  fresh: number;
  recycled: number;
  restored: number;
  admin_given: number;
  other: number;
  came_fresh?: number;
  came_recycled?: number;
  came_data?: number;
  came_restored?: number;
  came_admin_given?: number;
  came_other?: number;
  recycled_any?: number;
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
export type EmpRow = Partial<MetricRow> & { employee_id: string; name: string | null; active?: boolean };
export type EmpSourceRow = Partial<MetricRow> & { employee_id: string; source: string };
export interface PerfReport {
  def_version: number;
  api?: number;
  as_of: string | null;
  from: string;
  to: string;
  today?: string;
  data_since?: string | null;
  max_days?: number;
  totals: Partial<MetricRow>;
  by_employee: EmpRow[];
  by_source: (Partial<MetricRow> & { source: string })[];
  by_employee_type: (Partial<MetricRow> & { employee_id: string; lead_type: string | null })[];
  by_emp_source?: EmpSourceRow[];
  options: { employees: { id: string; name: string | null; active?: boolean }[]; teams: { id: string; name: string | null }[]; sources: string[]; projects: string[] } | null;
  definitions: { key: string; label: string; rule: string }[];
}

export type MetricKey =
  | "leads" | "came_fresh" | "came_recycled" | "came_data" | "came_restored" | "came_admin_given" | "came_other"
  | "recycled_any" | "fresh" | "recycled" | "restored" | "admin_given" | "other"
  | "followup" | "visit" | "visit_verified" | "booked" | "converted" | "details_est" | "not_connected" | "not_interested" | "no_result";

// "def" = the definitions key for the "i" popup.
export const METRIC: Record<MetricKey, { label: string; short: string; def: string }> = {
  leads: { label: "Leads received", short: "Leads", def: "leads" },
  came_fresh: { label: "Came as Fresh", short: "Fresh", def: "came_as" },
  came_recycled: { label: "Came as Recycled", short: "Recycled", def: "came_as" },
  came_data: { label: "Came as Data", short: "Data", def: "came_as" },
  came_restored: { label: "Came as Given back", short: "Given back", def: "came_as" },
  came_admin_given: { label: "Came By admin", short: "By admin", def: "came_as" },
  came_other: { label: "Came as Other", short: "Other", def: "came_as" },
  recycled_any: { label: "Recycled at least once", short: "Recycled ≥1", def: "recycled_any" },
  fresh: { label: "Fresh", short: "Fresh", def: "fresh" },
  recycled: { label: "Recycled", short: "Recycled", def: "recycled" },
  restored: { label: "Given back", short: "Given back", def: "restored" },
  admin_given: { label: "Given by admin", short: "By admin", def: "admin_given" },
  other: { label: "Other", short: "Other", def: "came_as" },
  followup: { label: "Follow-up", short: "Follow-up", def: "followup" },
  visit: { label: "Visits", short: "Visits", def: "visit" },
  visit_verified: { label: "Verified visits", short: "Verified", def: "visit_verified" },
  booked: { label: "Bookings", short: "Booked", def: "booked" },
  converted: { label: "Converted", short: "Converted", def: "converted" },
  details_est: { label: "Details sent, no visit", short: "Details (est.)", def: "details_est" },
  not_connected: { label: "Not connected", short: "Not conn.", def: "not_connected" },
  not_interested: { label: "Not interested", short: "Not int.", def: "not_interested" },
  no_result: { label: "No result", short: "No result", def: "status_mix" }
};
// How a lead came: add up to the row's leads (v2). Fresh / Recycled / Data / Given back / By admin / Other.
export const CAME_KEYS: MetricKey[] = ["came_fresh", "came_recycled", "came_data", "came_restored", "came_admin_given", "came_other"];
export const RESULT_KEYS: MetricKey[] = ["followup", "visit", "visit_verified", "booked", "converted", "details_est", "not_connected", "not_interested", "no_result"];
export const TABLE_KEYS: MetricKey[] = ["leads", ...CAME_KEYS, ...RESULT_KEYS];
// v1 fallback (v2 SQL not applied yet): origin counts (overlapping) instead of "came as".
export const TABLE_KEYS_V1: MetricKey[] = ["leads", "fresh", "recycled", "restored", "admin_given", ...RESULT_KEYS];
export const TILE_KEYS: MetricKey[] = ["leads", "came_fresh", "came_data", "recycled_any", "followup", "visit", "converted", "details_est", "not_connected", "not_interested"];
export const TILE_KEYS_V1: MetricKey[] = ["leads", "fresh", "recycled", "followup", "visit", "converted", "booked", "details_est", "not_connected", "not_interested"];
export const isV2 = (r: PerfReport | null | undefined) => (r?.api ?? 1) >= 2;

export const n = (r: Partial<MetricRow> | null | undefined, k: MetricKey | "stints" | "recycled_stints"): number => Number((r as Record<string, unknown> | undefined)?.[k] ?? 0) || 0;

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

// Dates (India time). The RPC takes IST days; at most MAX_DAYS between from and to.
export const MAX_DAYS = 800;
export const DATA_SINCE = "2026-08-17";
export type Preset = "today" | "last7" | "this_month" | "last_month" | "custom";
export const istYmd = (ms: number) => new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10);
export const addDays = (ymd: string, d: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + d * 86400e3).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400e3);
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
// A range the report can answer, or the message the page shows instead of asking.
export function rangeProblem(from: string, to: string, maxDays = MAX_DAYS): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return "Please choose both dates.";
  if (to < from) return "The end date is before the start date.";
  if (daysBetween(from, to) > maxDays) return `Please choose a range of ${maxDays} days or less.`;
  return null;
}
// A note for dates with no data yet (future days, or before the system's first assignment). Null = nothing to say.
export function rangeNote(from: string, to: string, today: string, dataSince = DATA_SINCE): string | null {
  if (from > today) return "No data yet: these dates are in the future.";
  if (to < dataSince) return `No data before ${rangeText(dataSince, dataSince)}.`;
  if (to > today) return `No data yet after today (${rangeText(today, today)}); the numbers cover up to today.`;
  if (from < dataSince) return `Data starts on ${rangeText(dataSince, dataSince)}.`;
  return null;
}
export function rangeText(from: string, to: string): string {
  const f = (s: string, withMonth: boolean) => new Date(`${s}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: withMonth ? "short" : undefined, timeZone: "UTC" });
  if (from === to) return f(from, true);
  return from.slice(0, 7) === to.slice(0, 7) ? `${f(from, false)}–${f(to, true)}` : `${f(from, true)} – ${f(to, true)}`;
}

export interface Filters {
  employee: string[];
  team: string;
  source: string[];
  project: string;
  leadType: "" | "LEAD" | "DATA";
  origin: string;
}
export const NO_FILTERS: Filters = { employee: [], team: "", source: [], project: "", leadType: "", origin: "" };
// Sent in the RPC body (POST), never in a URL, so long employee / source lists are fine.
export function filtersJson(f: Partial<Filters>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (f.employee?.length) out.employee_ids = [...new Set(f.employee)];
  if (f.team) out.team_ids = [f.team];
  if (f.source?.length) out.sources = [...new Set(f.source)];
  if (f.project) out.projects = [f.project];
  if (f.leadType) out.lead_type = f.leadType;
  if (f.origin) out.origins = f.origin === "OTHER" ? ["SELF", "OTHER"] : [f.origin];
  return out;
}
export const filtersActive = (f: Filters) => JSON.stringify(f) !== JSON.stringify(NO_FILTERS);

// Employee x Source: per employee (most leads first) its sources (most leads first), its subtotal (the employee row)
// and a grand total that is the sum of the employees.
export interface EmpSourceGroup { employee: EmpRow; sources: EmpSourceRow[] }
export function empSourceGroups(r: PerfReport): { groups: EmpSourceGroup[]; grand: Partial<MetricRow> } {
  const rows = r.by_emp_source ?? [];
  const groups = [...r.by_employee]
    .sort((a, b) => n(b, "leads") - n(a, "leads") || String(a.name ?? "").localeCompare(String(b.name ?? "")))
    .map((e) => ({ employee: e, sources: rows.filter((x) => x.employee_id === e.employee_id).sort((a, b) => n(b, "leads") - n(a, "leads") || a.source.localeCompare(b.source)) }));
  const grand: Record<string, number> = {};
  for (const g of groups) for (const k of [...TABLE_KEYS, "stints"] as const) grand[k] = (grand[k] ?? 0) + n(g.employee, k as MetricKey);
  return { groups, grand: grand as Partial<MetricRow> };
}

// CSV: count and % for every column; employee, employee x source, source, status / stage mix.
const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s;
};
const line = (cells: unknown[]) => cells.map(cell).join(",");
export function buildCsv(r: PerfReport, nameOf: (id: string) => string): string {
  const keys = isV2(r) ? TABLE_KEYS : TABLE_KEYS_V1;
  const head = (...first: string[]) => line([...first, ...keys.flatMap((k) => (k === "leads" ? [METRIC[k].label] : [METRIC[k].short, `${METRIC[k].short} %`]))]);
  const vals = (x: Partial<MetricRow>) => keys.flatMap((k) => (k === "leads" ? [n(x, "leads")] : [n(x, k), metricPct(x, k)]));
  const out: string[] = [];
  out.push(line([`Performance report ${r.from} to ${r.to} (definitions v${r.def_version}, as of ${r.as_of ?? "not built"})`]));
  out.push("", head("Employee"));
  for (const e of r.by_employee) out.push(line([e.name ?? nameOf(e.employee_id), ...vals(e)]));
  out.push(line(["Total (each lead once)", ...vals(r.totals)]));
  if (isV2(r)) {
    const { groups, grand } = empSourceGroups(r);
    out.push("", head("Employee", "Source"));
    for (const g of groups) {
      const name = g.employee.name ?? nameOf(g.employee.employee_id);
      for (const s of g.sources) out.push(line([name, s.source, ...vals(s)]));
      out.push(line([name, "All sources (subtotal)", ...vals(g.employee)]));
    }
    out.push(line(["Grand total (sum of employees)", "All sources", ...vals(grand)]));
  }
  out.push("", head("Source"));
  for (const s of r.by_source) out.push(line([s.source, ...vals(s)]));
  out.push(line(["Total", ...vals(r.totals)]));
  for (const [field, title, word] of [["status_mix", "Status", statusWord], ["stage_mix", "Stage", stageWord]] as const) {
    const mk = mixKeys([r.totals, ...r.by_employee], field);
    out.push("", line([`${title} mix: employee`, "Leads", ...mk.flatMap((k) => [word(k), `${word(k)} %`])]));
    for (const e of [...r.by_employee, { ...r.totals, name: "Total", employee_id: "" }])
      out.push(line([e.name ?? nameOf(e.employee_id), n(e, "leads"), ...mk.flatMap((k) => [Number(e[field]?.[k] ?? 0), mixPct(e, field, k)])]));
  }
  return out.join("\n") + "\n";
}
const ORIGIN_WORDS: Record<string, string> = { FRESH: "Fresh", RECYCLED: "Recycled", RESTORED: "Given back", ADMIN_GIVEN: "By admin", SELF: "Personal", OTHER: "Other" };
export const originWord = (k: unknown) => ORIGIN_WORDS[String(k)] ?? String(k ?? "");
export function buildDrillCsv(title: string, rows: Record<string, unknown>[]): string {
  const out = [line([title]), line(["Lead", "Employee", "Type", "Source", "Project", "Given as", "Given on (IST)", "Last result", "Stage"])];
  for (const x of rows)
    out.push(line([x.lead_name, x.employee_name, x.lead_type, x.source, x.project, originWord(x.origin),
      x.assigned_at ? istYmd(Date.parse(String(x.assigned_at))) : "", statusWord(String(x.last_result ?? "NO_RESULT")), stageWord(String(x.last_stage ?? "LEADS"))]));
  return out.join("\n") + "\n";
}

export function asOfText(iso: string | null): string {
  if (!iso) return "Not built yet";
  const d = new Date(iso);
  return `As of ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}, ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}`;
}

// Drill-down metric for a mix cell / a "came as" cell.
export const mixMetric = (field: "status_mix" | "stage_mix", key: string) => `${field === "status_mix" ? "status" : "stage"}:${key}`;
const CAME_METRIC: Record<string, string> = {
  came_fresh: "FRESH", came_recycled: "RECYCLED", came_data: "DATA", came_restored: "RESTORED", came_admin_given: "ADMIN_GIVEN", came_other: "OTHER"
};
export function drillMetric(k: MetricKey): string {
  return CAME_METRIC[k] ? `came:${CAME_METRIC[k]}` : k;
}
