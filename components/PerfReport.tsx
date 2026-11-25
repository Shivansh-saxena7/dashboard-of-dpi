"use client";
// Admin Performance Report (2026-11-20, v2 2026-11-23, simple view v3 2026-11-23), design: reports/perf_report_simple.
// One main table (row = employee; counts, then every % at the end), a plain-English line for one employee, optional
// split by Given as / Source. The earlier tiles, mixes and Employee x Source sit in "More details". Every number opens
// the leads behind it, each with its journey. Display only; the admin "give leads" controls (components/PerfReassign)
// show only while admin_report_reassign_mode is on.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDays, asOfText, buildDrillCsv, buildSimpleCsv, CAME_KEYS, CONVERTED_NOTE, DATA_SINCE, STATUS_MIX_LABEL, drillMetric, empSourceGroups,
  filterTags, filtersActive, isV2, isV3, istYmd, mainKeys, mainLabel, mainPctLabel, pctBaseText, pctKeysOf, isV4, MAX_DAYS, METRIC, metricPct, mixKeys, mixMetric, mixPct, n,
  NO_FILTERS, ORIGIN_CHIPS, originWord, presetRange, rangeNote, rangeText, reassignItems, splitRows, stageWord, statusTone, statusWord,
  summaryLine, TABLE_KEYS, TABLE_KEYS_V1, TILE_KEYS, TILE_KEYS_V1, TYPE_CHIPS,
  type Filters, type MetricKey, type MetricRow, type PerfReport, type Preset, type ReassignItem, type SplitBy, type Tone
} from "@/lib/perfReport";
import { DRILL_PAGE, usePerfReport, type DrillState } from "@/lib/usePerfReport";
import { Banner, BTN, CARD, CHIP, download, FOCUS, InfoButton, Pill, PRIMARY, Sheet, Skeleton } from "@/components/perfUi";
import { BatchesSection, GiveSheet, JourneySheet } from "@/components/PerfReassign";

const PRESETS: { key: Preset; label: string }[] = [
  { key: "today", label: "Today" }, { key: "last7", label: "Last 7 days" }, { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" }, { key: "custom", label: "Custom" }
];
// Short % headers under the "% of leads given" group header (full name in the tooltip and for screen readers).
const PCT_SHORT: Partial<Record<MetricKey, string>> = {
  followup: "Follow-ups", visit: "Visits", connected: "Conn.", converted: "Conv.", not_interested: "Not int.", not_connected: "Not conn.", details_est: "Details"
};
const SPLITS: { key: SplitBy; label: string }[] = [{ key: "none", label: "None" }, { key: "origin", label: "Given as" }, { key: "source", label: "Source" }];

// Pick several employees / sources. Checkbox list in a panel; Done applies (one report call per change).
function MultiSelect({ id, label, options, value, onChange }: { id: string; label: string; options: { v: string; l: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(value);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) setDraft(value); }, [open, value]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const shown = options.filter((o) => o.l.toLowerCase().includes(q.toLowerCase()));
  const summary = value.length === 0 ? "All" : value.length === 1 ? options.find((o) => o.v === value[0])?.l ?? "1 selected" : `${value.length} selected`;
  return (
    <div className="relative flex min-w-0 flex-col gap-1 text-[13px] font-semibold text-slate-700" ref={box}>
      <span id={`${id}-label`}>{label}</span>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-labelledby={`${id}-label`} data-testid={`perf-ms-${id}`}
        onClick={() => setOpen((o) => !o)}
        className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border px-3 text-left text-[15px] font-normal ${FOCUS} ${value.length ? "border-blue-200 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-900"}`}>
        <span className="truncate">{summary}</span>
        <span aria-hidden className="text-slate-600">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-[min(320px,90vw)] rounded-xl border border-slate-200 bg-white p-2 shadow-xl" data-testid={`perf-ms-${id}-panel`}>
          {options.length > 8 && (
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${label.toLowerCase()}`} aria-label={`Search ${label.toLowerCase()}`}
              className={`mb-2 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-[15px] font-normal ${FOCUS}`} />
          )}
          <div role="listbox" aria-multiselectable="true" aria-labelledby={`${id}-label`} className="max-h-64 overflow-y-auto">
            {shown.map((o) => (
              <label key={o.v} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-[15px] font-normal text-slate-900 hover:bg-slate-50">
                <input type="checkbox" className="h-5 w-5 accent-blue-700" checked={draft.includes(o.v)} data-testid={`perf-ms-${id}-opt`}
                  onChange={(e) => setDraft((d) => (e.target.checked ? [...d, o.v] : d.filter((x) => x !== o.v)))} />
                <span className="truncate">{o.l}</span>
              </label>
            ))}
            {shown.length === 0 && <p className="px-2 py-3 text-[15px] font-normal text-slate-600">No matches.</p>}
          </div>
          <div className="mt-2 flex gap-2 border-t border-slate-100 pt-2">
            <button type="button" className={`${BTN} flex-1`} onClick={() => setDraft([])} data-testid={`perf-ms-${id}-clear`}>Clear</button>
            <button type="button" data-testid={`perf-ms-${id}-done`} onClick={() => { onChange(draft); setOpen(false); }}
              className={`min-h-11 flex-1 rounded-xl bg-blue-700 px-4 text-[15px] font-semibold text-white hover:bg-blue-800 ${FOCUS}`}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Several-at-once chips (Given as, Type). None on = all.
function Chips<T extends string>({ id, label, options, value, onChange }: { id: string; label: string; options: { v: T; l: string }[]; value: T[]; onChange: (v: T[]) => void }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 text-[13px] font-semibold text-slate-700">
      <span id={`${id}-label`}>{label}</span>
      <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${id}-label`}>
        {options.map((o) => {
          const on = value.includes(o.v);
          return (
            <button key={o.v} type="button" aria-pressed={on} data-testid={`perf-chip-${id}-${o.v}`} className={CHIP(on)}
              onClick={() => onChange(on ? value.filter((x) => x !== o.v) : [...value, o.v])}>
              {on ? "✓ " : ""}{o.l}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function PerfReport({ reassign = false }: { reassign?: boolean }) {
  const [preset, setPreset] = useState<Preset>("last_month");
  const [custom, setCustom] = useState(() => presetRange("this_month", Date.now()));
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [split, setSplit] = useState<SplitBy>("none");
  const [more, setMore] = useState(false);
  const [view, setView] = useState<"count" | "pct">("count");
  const [mixBy, setMixBy] = useState<"employee" | "source">("employee");
  const [sort, setSort] = useState<{ key: MetricKey | "name"; dir: 1 | -1 }>({ key: "leads", dir: -1 });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [def, setDef] = useState<string | null>(null);
  const [journey, setJourney] = useState<{ id: string; name: string } | null>(null);
  const [batchKey, setBatchKey] = useState(0);
  const today = istYmd(Date.now());
  const range = preset === "custom" ? custom : presetRange(preset, Date.now());
  const rep = usePerfReport(range.from, range.to, filters, true);
  const r = rep.data;
  const v2 = isV2(r);
  const v3 = isV3(r);
  const keys = mainKeys(r);
  const pctKeys = pctKeysOf(keys);
  const tableKeys = v2 ? TABLE_KEYS : TABLE_KEYS_V1;
  const defs = useMemo(() => Object.fromEntries((r?.definitions ?? []).map((d) => [d.key, d])), [r]);
  const nameOf = (id: string) => r?.by_employee.find((e) => e.employee_id === id)?.name ?? r?.options?.employees.find((e) => e.id === id)?.name ?? id.slice(0, 8);
  const teamName = (id: string) => r?.options?.teams?.find((t) => t.id === id)?.name ?? id.slice(0, 8);
  const cellText = (row: Partial<MetricRow>, k: MetricKey) => (view === "pct" && k !== "leads" ? metricPct(row, k) : n(row, k).toLocaleString("en-IN"));
  const setF = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const drillTitle = (label: string, who?: string) => `${label} · ${who ?? "All"}`;
  const tags = filterTags(filters, nameOf, teamName);
  const sub = [rangeText(range.from, range.to), ...tags.map((t) => t.label)].join(" · ");
  const note = rep.invalid ? null : rangeNote(range.from, range.to, r?.today ?? today, r?.data_since ?? DATA_SINCE);
  const openCell = (k: MetricKey, who?: string, extra: Partial<Filters> = {}) => rep.openDrill(drillMetric(k), drillTitle(mainLabel(k), who), extra);
  const splitOk = split === "none" || (split === "origin" ? v3 : v2);

  const employees = useMemo(() => {
    const rows = [...(r?.by_employee ?? [])];
    rows.sort((a, b) => (sort.key === "name" ? String(a.name ?? "").localeCompare(String(b.name ?? "")) : n(a, sort.key) - n(b, sort.key)) * sort.dir);
    return rows;
  }, [r, sort]);
  const empOptions = (r?.options?.employees ?? []).map((e) => ({ v: e.id, l: `${e.name ?? e.id.slice(0, 8)}${e.active === false ? " (inactive)" : ""}` })).sort((a, b) => a.l.localeCompare(b.l));
  const one = filters.employee.length === 1 ? r?.by_employee.find((e) => e.employee_id === filters.employee[0]) ?? null : null;
  const sortHead = (key: MetricKey | "name", label: string, pct = false) => (
    <th key={`${key}${pct ? "%" : ""}`} data-label={pct ? mainPctLabel(key as MetricKey, isV4(r)) : label} aria-sort={!pct && sort.key === key ? (sort.dir < 0 ? "descending" : "ascending") : "none"}
      className={`p-0 align-bottom text-[13px] font-bold leading-tight ${key === "name" ? "text-left" : "text-right"} ${pct ? "bg-slate-50" : ""}`}>
      {pct ? <span className="block px-1 py-2.5" title={mainPctLabel(key as MetricKey, isV4(r))}><span aria-hidden>{label}</span><span className="sr-only">{mainPctLabel(key as MetricKey, isV4(r))}</span></span> : (
        <button type="button" data-testid={`perf-sort-${key}`} className={`min-h-11 w-full px-1 ${key === "name" ? "text-left" : "text-right"} ${FOCUS}`}
          onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : key === "name" ? 1 : -1 }))}>
          {label}{sort.key === key ? (sort.dir < 0 ? " ▼" : " ▲") : ""}
        </button>
      )}
    </th>
  );
  const select = (id: "team" | "project", label: string, value: string, options: { v: string; l: string }[]) => (
    <label className="flex min-w-0 flex-col gap-1 text-[13px] font-semibold text-slate-700">
      {label}
      <select value={value} data-testid={`perf-filter-${id}`} onChange={(e) => setF({ [id]: e.target.value } as Partial<Filters>)}
        className={`min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-[15px] font-normal text-slate-900 ${FOCUS}`}>
        <option value="">All</option>
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  );

  return (
    <div data-testid="perf-report" className="mx-auto w-full max-w-7xl space-y-4 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold tracking-tight text-slate-900">Performance report</h1>
          <p className="flex items-center text-[13px] text-slate-600" data-testid="perf-asof">
            {r ? `${asOfText(r.as_of)} (updated hourly) · Definitions v${r.def_version}` : "Loading…"}
            {r && <InfoButton label="how this is counted" onClick={() => setDef("range")} />}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={BTN} onClick={rep.retry} data-testid="perf-refresh" aria-busy={rep.loading} disabled={!!rep.invalid}>{rep.loading && !rep.invalid ? "Loading…" : "Refresh"}</button>
          <button type="button" disabled={!r || !!rep.invalid} data-testid="perf-csv" className={PRIMARY}
            onClick={() => r && download(`performance-report-${r.from}-to-${r.to}.csv`, buildSimpleCsv(r, employees, splitOk ? split : "none", nameOf))}>
            Export CSV
          </button>
        </div>
      </header>

      <section className={`${CARD} space-y-3`} aria-label="Filters">
        <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Date range">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" aria-pressed={preset === p.key} data-testid={`perf-preset-${p.key}`} onClick={() => setPreset(p.key)} className={CHIP(preset === p.key)}>
              {p.label}{p.key === preset && p.key !== "custom" ? ` · ${rangeText(range.from, range.to)}` : ""}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-slate-700">
              From
              <input type="date" value={custom.from} min={addDays(custom.to, -MAX_DAYS)} max={custom.to} data-testid="perf-custom-from"
                onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))}
                className={`min-h-11 rounded-xl border border-slate-200 px-3 text-[15px] font-normal ${FOCUS}`} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-slate-700">
              To
              <input type="date" value={custom.to} min={custom.from} max={addDays(custom.from, MAX_DAYS)} data-testid="perf-custom-to"
                onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))}
                className={`min-h-11 rounded-xl border border-slate-200 px-3 text-[15px] font-normal ${FOCUS}`} />
            </label>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          <MultiSelect id="employee" label="Employee" options={empOptions} value={filters.employee} onChange={(v) => setF({ employee: v })} />
          <MultiSelect id="source" label="Source" options={(r?.options?.sources ?? []).slice().sort().map((s) => ({ v: s, l: s }))} value={filters.source} onChange={(v) => setF({ source: v })} />
          {select("team", "Team", filters.team, (r?.options?.teams ?? []).map((t) => ({ v: t.id, l: t.name ?? t.id.slice(0, 8) })))}
          {select("project", "Project", filters.project, (r?.options?.projects ?? []).slice().sort().map((s) => ({ v: s, l: s })))}
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:gap-8">
          <Chips id="origin" label="Given as" options={ORIGIN_CHIPS} value={filters.origins} onChange={(v) => setF({ origins: v })} />
          <Chips id="type" label="Type" options={TYPE_CHIPS} value={filters.leadTypes} onChange={(v) => setF({ leadTypes: v })} />
        </div>
        {filtersActive(filters) && (
          <div className="flex flex-wrap items-center gap-2" data-testid="perf-active">
            {tags.map((t) => (
              <button key={t.key} type="button" onClick={() => setF(t.clear)} data-testid={`perf-tag-${t.key}`} aria-label={`Remove filter ${t.label}`}
                className={`inline-flex min-h-11 items-center gap-1 rounded-full bg-blue-50 px-3 text-[13px] font-semibold text-blue-700 ${FOCUS}`}>
                {t.label} <span aria-hidden>✕</span>
              </button>
            ))}
            <button type="button" className={BTN} onClick={() => setFilters(NO_FILTERS)} data-testid="perf-clear">Reset</button>
          </div>
        )}
        {rep.invalid && <Banner tone="amber" icon="▲" testId="perf-range-problem">{rep.invalid}</Banner>}
        {note && <Banner tone="blue" icon="◆" testId="perf-range-note">{note}</Banner>}
        {r && !v3 && <Banner tone="mute" icon="–" testId="perf-v1-note">Connected, several types at once and Split by Given as need the latest database update. Showing what this database has.</Banner>}
      </section>

      {rep.invalid ? null : rep.error ? (
        <button type="button" onClick={rep.retry} data-testid="perf-retry" className={`min-h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-left text-[15px] font-medium text-slate-700 ${FOCUS}`}>
          Couldn&apos;t load the report. Tap to try again.
        </button>
      ) : !r ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : (
        <div className={`space-y-4 transition-opacity motion-reduce:transition-none ${rep.loading ? "opacity-60" : ""}`} aria-busy={rep.loading}>
          {one && (
            <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-[15px] text-emerald-950" data-testid="perf-summary">
              {summaryLine(one.name ?? nameOf(one.employee_id), one, rangeText(range.from, range.to), v3)}
            </p>
          )}
          {n(r.totals, "leads") === 0 ? (
            <p data-testid="perf-empty" className={`${CARD} text-[15px] text-slate-700`}>No leads were given in this range with these filters.</p>
          ) : (
            <section className={CARD} aria-labelledby="perf-main-h" data-testid="perf-main">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="perf-main-h" className="text-base font-semibold text-slate-900">Leads given and what happened</h2>
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Split by">
                  <span className="text-[13px] font-semibold text-slate-700">Split by</span>
                  {SPLITS.map((s) => (
                    <button key={s.key} type="button" aria-pressed={split === s.key} data-testid={`perf-split-${s.key}`} onClick={() => setSplit(s.key)} className={CHIP(split === s.key)}
                      disabled={s.key === "origin" ? !v3 : s.key === "source" ? !v2 : false}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-2 hidden overflow-x-auto lg:block">
                <table className="w-full border-collapse text-[14px] tabular-nums" data-testid="perf-main-table">
                  <thead>
                    <tr className="text-[13px] text-slate-600">
                      <th colSpan={1 + keys.length} aria-hidden />
                      <th colSpan={pctKeys.length} className="rounded-t-lg bg-slate-50 px-1 pt-2 text-center font-bold text-slate-700" data-testid="perf-main-pct-head">{pctBaseText(r)}</th>
                    </tr>
                    <tr className="border-b border-slate-200 text-[13px] text-slate-600">
                      {sortHead("name", "Employee")}
                      {keys.map((k) => sortHead(k, mainLabel(k)))}
                      {pctKeys.map((k) => sortHead(k, PCT_SHORT[k] ?? mainLabel(k), true))}
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((e) => {
                      const name = e.name ?? nameOf(e.employee_id);
                      const subs = splitOk ? splitRows(r, split, e.employee_id) : [];
                      return [
                        <tr key={e.employee_id} className="border-b border-slate-100 hover:bg-slate-50" data-testid={`perf-main-row-${e.employee_id}`}>
                          <td className="min-w-[104px] px-1 py-1 text-left font-semibold leading-tight">{name}{e.active === false ? " (inactive)" : ""}</td>
                          {keys.map((k) => (
                            <td key={k} className="px-0 py-1 text-right">
                              <button type="button" data-testid={`perf-main-cell-${e.employee_id}-${k}`} onClick={() => openCell(k, name, { employee: [e.employee_id] })}
                                className={`min-h-11 min-w-11 rounded-lg px-1 text-right hover:text-blue-700 hover:underline ${FOCUS}`}>
                                {n(e, k).toLocaleString("en-IN")}
                              </button>
                            </td>
                          ))}
                          {pctKeys.map((k) => <td key={`${k}%`} className="bg-slate-50 px-1 py-1 text-right text-[13px] text-slate-700" data-testid={`perf-main-pct-${e.employee_id}-${k}`}>{metricPct(e, k)}</td>)}
                        </tr>,
                        ...subs.map((s) => (
                          <tr key={`${e.employee_id}|${s.key}`} className="border-b border-slate-100 bg-slate-50/60 text-[13px] text-slate-700" data-testid={`perf-split-row-${e.employee_id}-${s.key}`}>
                            <td className="whitespace-nowrap py-1 pl-6 pr-2 text-left">{s.label}</td>
                            {keys.map((k) => (
                              <td key={k} className="px-1 py-1 text-right">
                                <button type="button" onClick={() => openCell(k, `${name} · ${s.label}`, { employee: [e.employee_id], ...s.extra })}
                                  className={`min-h-11 min-w-11 rounded-lg px-1 text-right hover:text-blue-700 hover:underline ${FOCUS}`}>
                                  {n(s.row, k).toLocaleString("en-IN")}
                                </button>
                              </td>
                            ))}
                            {pctKeys.map((k) => <td key={`${k}%`} className="bg-slate-50 px-2 py-1 text-right">{metricPct(s.row, k)}</td>)}
                          </tr>
                        ))
                      ];
                    })}
                    <tr className="font-bold" data-testid="perf-main-total">
                      <td className="px-1 py-2.5 text-left leading-tight">Total (each lead once)</td>
                      {keys.map((k) => <td key={k} className="px-1 py-2.5 text-right">{n(r.totals, k).toLocaleString("en-IN")}</td>)}
                      {pctKeys.map((k) => <td key={`${k}%`} className="bg-slate-50 px-1 py-2.5 text-right text-[13px]">{metricPct(r.totals, k)}</td>)}
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="mt-3 space-y-2 lg:hidden" data-testid="perf-main-cards">
                {employees.map((e) => {
                  const name = e.name ?? nameOf(e.employee_id);
                  const subs = splitOk ? splitRows(r, split, e.employee_id) : [];
                  return (
                    <div key={e.employee_id} className="rounded-xl border border-slate-200 p-3" data-testid={`perf-main-card-${e.employee_id}`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <b className="truncate text-[15px] text-slate-900">{name}{e.active === false ? " (inactive)" : ""}</b>
                        <button type="button" onClick={() => openCell("leads", name, { employee: [e.employee_id] })} className={`min-h-11 text-[13px] font-semibold text-slate-700 ${FOCUS}`}>
                          {n(e, "leads").toLocaleString("en-IN")} leads given
                        </button>
                      </div>
                      <div className="mt-1 grid grid-cols-2 gap-2">
                        {pctKeys.map((k) => (
                          <button key={k} type="button" data-testid={`perf-main-card-cell-${e.employee_id}-${k}`} onClick={() => openCell(k, name, { employee: [e.employee_id] })}
                            className={`min-h-11 rounded-lg bg-slate-50 p-2 text-left ${FOCUS}`}>
                            <span className="block text-[13px] text-slate-600">{mainLabel(k)}</span>
                            <b className="text-[15px] text-slate-900">{n(e, k).toLocaleString("en-IN")}</b> <span className="text-[13px] text-slate-700">{metricPct(e, k)}</span>
                          </button>
                        ))}
                      </div>
                      {subs.length > 0 && (
                        <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-[13px] text-slate-700" data-testid={`perf-main-card-split-${e.employee_id}`}>
                          {subs.map((s) => (
                            <li key={s.key}><b>{s.label}</b>: {n(s.row, "leads")} leads · {pctKeys.filter((k) => n(s.row, k) > 0).map((k) => `${mainLabel(k).replace(" (estimate)", "")} ${n(s.row, k)}`).join(" · ") || "nothing yet"}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
                <div className="rounded-xl bg-slate-100 p-3 text-[13px] text-slate-800" data-testid="perf-main-card-total">
                  <b className="text-[15px]">Total: {n(r.totals, "leads").toLocaleString("en-IN")} leads given</b>
                  <p>{pctKeys.map((k) => `${mainLabel(k).replace(" (estimate)", "")} ${n(r.totals, k)} (${metricPct(r.totals, k)})`).join(" · ")}</p>
                </div>
              </div>
              <p className="mt-2 flex flex-wrap items-center text-[13px] text-slate-600">
                Tap a number to see the leads. % = share of {isV4(r) ? "leads handled" : "leads given"}. Details shared is an estimate.
                {split !== "none" && " A lead given to the same person in two ways counts in both split rows."}
                {v3 && <InfoButton label="Connected" onClick={() => setDef("connected")} />}
              </p>
            </section>
          )}

          {reassign && v3 && <BatchesSection from={range.from} to={range.to} refreshKey={batchKey} onChanged={() => { setBatchKey((k) => k + 1); void rep.retry(); }} />}

          <section className={CARD} data-testid="perf-more">
            <button type="button" aria-expanded={more} onClick={() => setMore((m) => !m)} data-testid="perf-more-toggle"
              className={`flex min-h-11 w-full items-center justify-between gap-2 text-left text-base font-semibold text-slate-900 ${FOCUS}`}>
              More details: tiles, by source, status and stage mix, employee x source
              <span aria-hidden>{more ? "▾" : "▸"}</span>
            </button>
            {more && n(r.totals, "leads") > 0 && (
              <div className="mt-3 space-y-4" data-testid="perf-more-body">
                <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                  {(v2 ? TILE_KEYS : TILE_KEYS_V1).map((k) => {
                    const m = METRIC[k];
                    const v = n(r.totals, k);
                    return (
                      <div key={k} role="button" tabIndex={0} data-testid={`perf-tile-${k}`}
                        onClick={() => openCell(k)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCell(k); } }}
                        className={`flex min-h-[104px] cursor-pointer flex-col justify-between rounded-2xl border border-slate-200 bg-white p-3 text-left hover:bg-slate-50 active:scale-[0.98] motion-reduce:transform-none ${FOCUS}`}>
                        <span className="flex items-start justify-between gap-1">
                          <span className="text-[13px] font-semibold text-slate-700">{m.label}</span>
                          <InfoButton label={m.label} onClick={() => setDef(m.def)} />
                        </span>
                        <span className={`text-[28px] font-bold leading-none tabular-nums ${v === 0 ? "text-slate-600" : "text-slate-900"}`}>{v.toLocaleString("en-IN")}</span>
                        {k === "details_est" ? (
                          <span className="flex flex-wrap items-center gap-1"><Pill tone="amber" icon="◐">Estimate</Pill><span className="text-[13px] font-bold text-slate-700" data-testid={`perf-tile-${k}-pct`}>{metricPct(r.totals, k)}</span></span>
                        ) : (
                          <span className="text-[13px] font-bold text-slate-700" data-testid={`perf-tile-${k}-pct`}>
                            {k === "leads" ? `${n(r.totals, "stints").toLocaleString("en-IN")} assignments` : `${metricPct(r.totals, k)} of leads`}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </section>

                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Show">
                  {(["count", "pct"] as const).map((v) => (
                    <button key={v} type="button" aria-pressed={view === v} data-testid={`perf-view-${v}`} onClick={() => setView(v)} className={CHIP(view === v)}>
                      {v === "count" ? "Counts" : "% of leads"}
                    </button>
                  ))}
                  <InfoButton label="% of leads" onClick={() => setDef("percent")} />
                  {v2 && <span className="text-[13px] text-slate-600">Fresh to Other = how each lead came; they add up to Leads.</span>}
                </div>

                <section className={CARD} aria-labelledby="perf-emp-h">
                  <div className="flex items-center justify-between gap-2">
                    <h2 id="perf-emp-h" className="text-base font-semibold text-slate-900">By employee (all columns)</h2>
                    <span className="flex items-center text-[13px] text-slate-600">Tap a number to see the leads{v2 && <InfoButton label="came as" onClick={() => setDef("came_as")} />}</span>
                  </div>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full border-collapse text-[15px] tabular-nums" data-testid="perf-emp-table">
                      <thead>
                        <tr className="border-b border-slate-200 text-[13px] text-slate-600">
                          <th className="whitespace-nowrap px-2 py-2.5 text-left font-bold">Employee</th>
                          {tableKeys.map((k) => <th key={k} className={`whitespace-nowrap px-2 py-2.5 text-right font-bold ${CAME_KEYS.includes(k) ? "bg-slate-50" : ""}`}>{METRIC[k].short}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {employees.map((e) => (
                          <EmployeeRows key={e.employee_id} e={e} r={r} cols={tableKeys} open={open.has(e.employee_id)} cellText={cellText}
                            toggle={() => setOpen((o) => { const x = new Set(o); if (x.has(e.employee_id)) x.delete(e.employee_id); else x.add(e.employee_id); return x; })}
                            drill={(k) => openCell(k, e.name ?? undefined, { employee: [e.employee_id] })} />
                        ))}
                        <tr className="font-bold">
                          <td className="px-2 py-2.5 text-left">Total (each lead once)</td>
                          {tableKeys.map((k) => <td key={k} className={`px-2 py-2.5 text-right ${CAME_KEYS.includes(k) ? "bg-slate-50" : ""}`}>{cellText(r.totals, k)}</td>)}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>

                {v2 && <EmpSource r={r} view={view} cellText={cellText} nameOf={nameOf} onDef={() => setDef("emp_source")}
                  drill={(k, who, extra) => openCell(k, who, extra)} />}

                <section className={CARD} aria-labelledby="perf-src-h">
                  <h2 id="perf-src-h" className="text-base font-semibold text-slate-900">By source</h2>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full border-collapse text-[15px] tabular-nums" data-testid="perf-src-table">
                      <thead>
                        <tr className="border-b border-slate-200 text-[13px] text-slate-600">
                          <th className="whitespace-nowrap px-2 py-2.5 text-left font-bold">Source</th>
                          {tableKeys.map((k) => <th key={k} className={`whitespace-nowrap px-2 py-2.5 text-right font-bold ${CAME_KEYS.includes(k) ? "bg-slate-50" : ""}`}>{METRIC[k].short}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {(r.by_source ?? []).map((s) => (
                          <tr key={s.source} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="whitespace-nowrap px-2 py-1 text-left">{s.source}</td>
                            {tableKeys.map((k) => (
                              <td key={k} className={`px-1 py-1 text-right ${CAME_KEYS.includes(k) ? "bg-slate-50" : ""}`}>
                                <button type="button" data-testid={`perf-src-cell-${s.source}-${k}`} className={`min-h-11 min-w-11 rounded-lg px-1 text-right hover:text-blue-700 hover:underline ${FOCUS}`}
                                  onClick={() => openCell(k, s.source, { source: [s.source] })}>
                                  {cellText(s, k)}
                                </button>
                              </td>
                            ))}
                          </tr>
                        ))}
                        <tr className="font-bold">
                          <td className="px-2 py-2.5 text-left">Total</td>
                          {tableKeys.map((k) => <td key={k} className={`px-2 py-2.5 text-right ${CAME_KEYS.includes(k) ? "bg-slate-50" : ""}`}>{cellText(r.totals, k)}</td>)}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>

                <div className="flex items-center gap-2" role="group" aria-label="Mix by">
                  {(["employee", "source"] as const).map((v) => (
                    <button key={v} type="button" aria-pressed={mixBy === v} data-testid={`perf-mixby-${v}`} onClick={() => setMixBy(v)} className={CHIP(mixBy === v)}>
                      Mix by {v}
                    </button>
                  ))}
                </div>
                {(["status_mix", "stage_mix"] as const).map((field) => (
                  <Mix key={field} field={field} r={r} by={mixBy} view={view} nameOf={nameOf} onDef={() => setDef(field)}
                    drill={(key, label, extra) => rep.openDrill(mixMetric(field, key), label, extra)} />
                ))}
                <p className="text-[13px] text-slate-600">Teams: older months use the team each person was in when the row was first recorded. A lead handled by several people counts once per person in the employee tables.</p>
              </div>
            )}
          </section>
        </div>
      )}

      {rep.drill && (
        <Drill d={rep.drill} sub={sub} onClose={rep.closeDrill} reassign={reassign && v3} canJourney={v3} nameOf={nameOf}
          onJourney={(id, name) => setJourney({ id, name })}
          more={() => rep.openDrill(rep.drill!.metric, rep.drill!.title, rep.drill!.extra, rep.drill!.rows.length)}
          allRows={(progress) => rep.allDrillRows(rep.drill!.metric, rep.drill!.extra, progress)}
          exportAll={async (progress) => {
            const d = rep.drill!;
            const rows = await rep.allDrillRows(d.metric, d.extra, progress);
            download(`performance-report-leads-${range.from}-to-${range.to}.csv`, buildDrillCsv(rows));
          }}
          onMoved={() => {
            const d = rep.drill!;
            setBatchKey((k) => k + 1);
            void rep.retry();
            void rep.openDrill(d.metric, d.title, d.extra);
          }} />
      )}
      {journey && <JourneySheet leadId={journey.id} leadName={journey.name} withBatches={reassign} onClose={() => setJourney(null)} />}
      {def && (
        <Sheet title={defs[def]?.label ?? "Definition"} sub={`Definitions v${r?.def_version ?? 1}`} onClose={() => setDef(null)} testId="perf-def">
          <p className="text-[15px] text-slate-800">{defs[def]?.rule ?? "—"}</p>
          {def === "converted" && <p className="mt-2 text-[15px] text-slate-800" data-testid="perf-def-converted-note">{CONVERTED_NOTE}</p>}
          <p className="mt-3 text-[13px] text-slate-600">Each lead is credited to the person who had it at the time, so a lead’s status today never changes past numbers.</p>
        </Sheet>
      )}
    </div>
  );
}

function EmployeeRows({ e, r, cols, open, toggle, drill, cellText }: {
  e: PerfReport["by_employee"][number]; r: PerfReport; cols: MetricKey[]; open: boolean; toggle: () => void;
  drill: (k: MetricKey) => void; cellText: (row: Partial<MetricRow>, k: MetricKey) => string;
}) {
  const types = (r.by_employee_type ?? []).filter((t) => t.employee_id === e.employee_id);
  return (
    <>
      <tr className="border-b border-slate-100 hover:bg-slate-50" data-testid={`perf-emp-row-${e.employee_id}`}>
        <td className="px-1 py-1 text-left">
          <button type="button" aria-expanded={open} onClick={toggle} data-testid={`perf-emp-expand-${e.employee_id}`}
            className={`min-h-11 whitespace-nowrap rounded-lg px-1 text-left font-semibold text-blue-700 ${FOCUS}`}>
            <span aria-hidden>{open ? "▾" : "▸"}</span> {e.name ?? e.employee_id.slice(0, 8)}{e.active === false ? " (inactive)" : ""}
          </button>
        </td>
        {cols.map((k) => (
          <td key={k} className={`px-1 py-1 text-right ${CAME_KEYS.includes(k) ? "bg-slate-50" : ""}`}>
            <button type="button" data-testid={`perf-emp-cell-${e.employee_id}-${k}`} onClick={() => drill(k)}
              className={`min-h-11 min-w-11 rounded-lg px-1 text-right hover:text-blue-700 hover:underline ${FOCUS}`}>
              {cellText(e, k)}
            </button>
          </td>
        ))}
      </tr>
      {open && types.map((t) => (
        <tr key={t.lead_type ?? "none"} className="border-b border-slate-100 bg-slate-50 text-[13px] text-slate-700" data-testid={`perf-emp-sub-${e.employee_id}-${t.lead_type}`}>
          <td className="px-3 py-2 text-left">{t.lead_type === "DATA" ? "Data" : t.lead_type === "LEAD" ? "Leads" : "Other"}</td>
          {cols.map((k) => <td key={k} className="px-2 py-2 text-right">{cellText(t, k)}</td>)}
        </tr>
      ))}
    </>
  );
}

// Employee x Source: every employee, its sources, a subtotal, and a grand total (sum of employees).
const ES_KEYS: MetricKey[] = ["leads", ...CAME_KEYS, "followup", "visit", "converted", "details_est", "not_connected", "not_interested"];
function EmpSource({ r, view, cellText, nameOf, drill, onDef }: {
  r: PerfReport; view: "count" | "pct"; cellText: (row: Partial<MetricRow>, k: MetricKey) => string; nameOf: (id: string) => string;
  drill: (k: MetricKey, who: string, extra: Partial<Filters>) => void; onDef: () => void;
}) {
  const { groups, grand } = useMemo(() => empSourceGroups(r), [r]);
  void view;
  return (
    <section className={CARD} aria-labelledby="perf-es-h" data-testid="perf-es">
      <div className="flex items-center justify-between gap-2">
        <h2 id="perf-es-h" className="text-base font-semibold text-slate-900">Employee x Source</h2>
        <InfoButton label="Employee x Source" onClick={onDef} />
      </div>
      <div className="mt-2 max-h-[70vh] overflow-auto">
        <table className="w-full border-collapse text-[15px] tabular-nums" data-testid="perf-es-table">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-slate-200 text-[13px] text-slate-600">
              <th className="whitespace-nowrap px-2 py-2.5 text-left font-bold">Employee</th>
              <th className="whitespace-nowrap px-2 py-2.5 text-left font-bold">Source</th>
              {ES_KEYS.map((k) => <th key={k} className={`whitespace-nowrap px-2 py-2.5 text-right font-bold ${CAME_KEYS.includes(k) ? "bg-slate-50" : ""}`}>{METRIC[k].short}</th>)}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const name = g.employee.name ?? nameOf(g.employee.employee_id);
              return [
                ...g.sources.map((s) => (
                  <tr key={`${g.employee.employee_id}|${s.source}`} className="border-b border-slate-100 hover:bg-slate-50" data-testid={`perf-es-row-${g.employee.employee_id}-${s.source}`}>
                    <td className="whitespace-nowrap px-2 py-1 text-left text-slate-700">{name}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-left">{s.source}</td>
                    {ES_KEYS.map((k) => (
                      <td key={k} className={`px-1 py-1 text-right ${CAME_KEYS.includes(k) ? "bg-slate-50" : ""}`}>
                        <button type="button" data-testid={`perf-es-cell-${g.employee.employee_id}-${s.source}-${k}`}
                          onClick={() => drill(k, `${name} · ${s.source}`, { employee: [g.employee.employee_id], source: [s.source] })}
                          className={`min-h-11 min-w-11 rounded-lg px-1 text-right hover:text-blue-700 hover:underline ${FOCUS}`}>
                          {cellText(s, k)}
                        </button>
                      </td>
                    ))}
                  </tr>
                )),
                <tr key={`${g.employee.employee_id}|sub`} className="border-b border-slate-200 bg-slate-100 font-bold" data-testid={`perf-es-sub-${g.employee.employee_id}`}>
                  <td className="whitespace-nowrap px-2 py-2.5 text-left">{name}</td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-left">All sources</td>
                  {ES_KEYS.map((k) => <td key={k} className="px-2 py-2.5 text-right">{cellText(g.employee, k)}</td>)}
                </tr>
              ];
            })}
            <tr className="border-t-2 border-slate-400 font-bold" data-testid="perf-es-grand">
              <td className="whitespace-nowrap px-2 py-2.5 text-left">Grand total</td>
              <td className="whitespace-nowrap px-2 py-2.5 text-left">Sum of employees</td>
              {ES_KEYS.map((k) => <td key={k} className="px-2 py-2.5 text-right">{cellText(grand, k)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[13px] text-slate-600">A lead handled by two people counts for both, so the grand total is more than the leads received.</p>
    </section>
  );
}

function Mix({ field, r, by, view, nameOf, drill, onDef }: {
  field: "status_mix" | "stage_mix"; r: PerfReport; by: "employee" | "source"; view: "count" | "pct"; nameOf: (id: string) => string;
  drill: (key: string, label: string, extra: Partial<Filters>) => void; onDef: () => void;
}) {
  const rows: { id: string; label: string; row: Partial<MetricRow>; extra: Partial<Filters> }[] = [
    ...(by === "employee"
      ? (r.by_employee ?? []).map((e) => ({ id: e.employee_id, label: e.name ?? nameOf(e.employee_id), row: e as Partial<MetricRow>, extra: { employee: [e.employee_id] } as Partial<Filters> }))
      : (r.by_source ?? []).map((s) => ({ id: s.source, label: s.source, row: s as Partial<MetricRow>, extra: { source: [s.source] } as Partial<Filters> }))),
    { id: "total", label: "Total", row: r.totals, extra: {} }
  ];
  const keys = mixKeys(rows.map((x) => x.row), field);
  const word = field === "status_mix" ? statusWord : stageWord;
  const title = field === "status_mix" ? "Status mix" : "Stage mix";
  return (
    <section className={CARD} aria-label={title} data-testid={`perf-${field.replace("_", "-")}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {field === "status_mix" && <p className="text-[13px] text-slate-600" data-testid="perf-status-mix-label">{STATUS_MIX_LABEL}</p>}
        </div>
        <InfoButton label={title} onClick={onDef} />
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-[15px] tabular-nums">
          <thead>
            <tr className="border-b border-slate-200 text-[13px] text-slate-600">
              <th className="whitespace-nowrap px-2 py-2.5 text-left font-bold">{by === "employee" ? "Employee" : "Source"}</th>
              <th className="whitespace-nowrap px-2 py-2.5 text-right font-bold">Leads</th>
              {keys.map((k) => {
                const t = field === "status_mix" ? statusTone(k) : { tone: "mute" as Tone, icon: "" };
                return (
                  <th key={k} className="whitespace-nowrap px-2 py-2.5 text-right font-bold" data-testid={`perf-mix-col-${field}-${k}`}>
                    {field === "status_mix" ? <Pill tone={t.tone} icon={t.icon}>{word(k)}</Pill> : word(k)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id} className={`border-b border-slate-100 ${x.id === "total" ? "font-bold" : "hover:bg-slate-50"}`}>
                <td className="whitespace-nowrap px-2 py-1 text-left">{x.label}</td>
                <td className="px-2 py-1 text-right">{n(x.row, "leads").toLocaleString("en-IN")}</td>
                {keys.map((k) => {
                  const count = Number(x.row[field]?.[k] ?? 0);
                  return (
                    <td key={k} className="px-1 py-1 text-right">
                      <button type="button" data-testid={`perf-mix-cell-${field}-${x.id}-${k}`} disabled={count === 0}
                        title={`${count} of ${n(x.row, "leads")} leads`} onClick={() => drill(k, `${word(k)} · ${x.label}`, x.extra)}
                        className={`min-h-11 min-w-11 rounded-lg px-1 text-right enabled:hover:text-blue-700 enabled:hover:underline disabled:text-slate-600 ${FOCUS}`}>
                        {view === "pct" ? mixPct(x.row, field, k) : count.toLocaleString("en-IN")}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// The leads behind one number. Each lead opens its journey (v3). With the admin give controls on: tick leads (or
// "Select all N"), then Give to… / Give back to the row's employee; the confirm sheet previews before anything moves.
function Drill({ d, sub, onClose, more, exportAll, allRows, reassign, canJourney, nameOf, onJourney, onMoved }: {
  d: DrillState; sub: string; onClose: () => void; more: () => void; exportAll: (progress: (done: number, total: number) => void) => Promise<void>;
  allRows: (progress: (done: number, total: number) => void) => Promise<Record<string, unknown>[]>;
  reassign: boolean; canJourney: boolean; nameOf: (id: string) => string; onJourney: (id: string, name: string) => void; onMoved: () => void;
}) {
  const [csv, setCsv] = useState<{ busy: boolean; done: number; total: number; error: boolean }>({ busy: false, done: 0, total: 0, error: false });
  const [sel, setSel] = useState<Map<string, ReassignItem>>(new Map());
  const [all, setAll] = useState<{ busy: boolean; error: boolean }>({ busy: false, error: false });
  const [give, setGive] = useState<"give" | "give_back" | null>(null);
  const [allLoaded, setAllLoaded] = useState<Record<string, unknown>[]>([]);
  const owners = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of [...d.rows, ...allLoaded]) if (x.current_owner_id && x.current_owner_name) m.set(String(x.current_owner_id), String(x.current_owner_name));
    return m;
  }, [d.rows, allLoaded]);
  const rowEmp = d.extra.employee?.length === 1 ? { id: d.extra.employee[0], name: nameOf(d.extra.employee[0]) } : null;
  const toggle = (x: Record<string, unknown>, on: boolean) =>
    setSel((s) => {
      const m = new Map(s);
      const [item] = reassignItems([x]);
      if (!item) return m;
      if (on) m.set(item.lead_id, item);
      else m.delete(item.lead_id);
      return m;
    });
  return (
    <Sheet title={d.title} sub={d.loading && !d.rows.length ? "Loading…" : `${d.total.toLocaleString("en-IN")} leads · ${sub}`} onClose={onClose} testId="perf-drill" wide={reassign}>
      {d.rows.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <button type="button" data-testid="perf-drill-csv" disabled={csv.busy} className={BTN}
            onClick={async () => {
              setCsv({ busy: true, done: 0, total: d.total, error: false });
              try {
                await exportAll((done, total) => setCsv((c) => ({ ...c, done, total })));
                setCsv((c) => ({ ...c, busy: false }));
              } catch {
                setCsv((c) => ({ ...c, busy: false, error: true }));
              }
            }}>
            {csv.busy ? `Preparing ${csv.done.toLocaleString("en-IN")} of ${csv.total.toLocaleString("en-IN")}…` : "Export these leads (CSV)"}
          </button>
          {csv.error && <span className="text-[13px] font-semibold text-red-700" data-testid="perf-drill-csv-error">✕ Couldn&apos;t export. Try again.</span>}
          {reassign && (
            <button type="button" className={BTN} disabled={all.busy} data-testid="perf-drill-select-all"
              onClick={async () => {
                if (sel.size >= d.total) { setSel(new Map()); return; }
                setAll({ busy: true, error: false });
                try {
                  const rows = await allRows(() => undefined);
                  setAllLoaded(rows);
                  setSel(new Map(reassignItems(rows).map((x) => [x.lead_id, x])));
                  setAll({ busy: false, error: false });
                } catch {
                  setAll({ busy: false, error: true });
                }
              }}>
              {all.busy ? "Selecting…" : sel.size >= d.total ? "Clear selection" : `Select all ${d.total.toLocaleString("en-IN")}`}
            </button>
          )}
          {all.error && <span className="text-[13px] font-semibold text-red-700">✕ Couldn&apos;t select all. Try again.</span>}
        </div>
      )}
      {d.error && !d.rows.length ? (
        <button type="button" onClick={more} className={`min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-left text-[15px] text-slate-700 ${FOCUS}`} data-testid="perf-drill-retry">
          Couldn&apos;t load these leads. Tap to try again.
        </button>
      ) : d.loading && !d.rows.length ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : d.rows.length === 0 ? (
        <p className="text-[15px] text-slate-700">No leads.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {d.rows.map((x) => {
            const res = String(x.last_result ?? "NO_RESULT");
            const t = statusTone(res);
            const id = String(x.lead_id);
            const name = String(x.lead_name ?? "Lead");
            return (
              <li key={String(x.stint_id)} className={`grid ${reassign ? "grid-cols-[44px_1fr_auto]" : "grid-cols-[1fr_auto]"} items-center gap-x-2 gap-y-0.5 py-2.5`} data-testid="perf-drill-row">
                {reassign && (
                  <label className="row-span-2 grid h-11 w-11 cursor-pointer place-items-center">
                    <input type="checkbox" className="h-5 w-5 accent-blue-700" checked={sel.has(id)} onChange={(e) => toggle(x, e.target.checked)}
                      aria-label={`Select ${name}`} data-testid="perf-drill-check" />
                  </label>
                )}
                <b className="truncate text-[15px] text-slate-900">{name}</b>
                <span className="flex flex-wrap justify-end gap-1">
                  {reassign && x.positive === true && <Pill tone="green" icon="★">Positive</Pill>}
                  <Pill tone={t.tone} icon={t.icon}>{statusWord(res)}</Pill>
                </span>
                <span className="truncate text-[13px] text-slate-600">
                  {[x.employee_name, x.source, x.project, originWord(x.origin)].filter(Boolean).join(" · ")}
                  {reassign && x.current_owner_id && x.current_owner_id !== x.employee_id ? ` · now with ${String(x.current_owner_name ?? "someone else")}` : ""}
                </span>
                <span className="flex items-center justify-end gap-1 text-[13px] text-slate-600">
                  {x.event_at ? "On " : ""}{new Date(String(x.event_at ?? x.assigned_at)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })} · {stageWord(String(x.last_stage ?? "LEADS"))}
                  {canJourney && (
                    <button type="button" onClick={() => onJourney(id, name)} data-testid="perf-drill-journey"
                      className={`min-h-11 rounded-lg px-2 font-semibold text-blue-700 hover:underline ${FOCUS}`}>Journey</button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {d.rows.length > 0 && d.rows.length < d.total && (
        <button type="button" onClick={more} disabled={d.loading} data-testid="perf-drill-more" className={`${BTN} mt-3 w-full`}>
          {d.loading ? "Loading…" : `Load ${Math.min(DRILL_PAGE, d.total - d.rows.length)} more`}
        </button>
      )}
      {reassign && sel.size > 0 && (
        <div className="sticky bottom-0 -mx-4 mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white px-4 py-3" data-testid="perf-drill-actions">
          <b className="text-[15px] text-slate-900" data-testid="perf-drill-selected">{sel.size.toLocaleString("en-IN")} selected</b>
          <button type="button" className={PRIMARY} onClick={() => setGive("give")} data-testid="perf-drill-give">Give to…</button>
          {rowEmp && <button type="button" className={BTN} onClick={() => setGive("give_back")} data-testid="perf-drill-give-back">Give back to {rowEmp.name}</button>}
        </div>
      )}
      {give && (
        <GiveSheet items={[...sel.values()]} mode={give} giveBackTo={give === "give_back" && rowEmp ? rowEmp : undefined}
          ownerName={(id) => owners.get(id) ?? nameOf(id)} onClose={() => setGive(null)}
          onDone={() => { setGive(null); setSel(new Map()); onMoved(); }} />
      )}
    </Sheet>
  );
}
