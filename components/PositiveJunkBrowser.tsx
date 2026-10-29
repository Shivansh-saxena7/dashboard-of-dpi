"use client";

import { useMemo, useState } from "react";
import { RefreshCw, RotateCcw, X } from "lucide-react";
import toast from "react-hot-toast";
import PositiveJunkRestoreModal from "@/components/PositiveJunkRestoreModal";
import {
  ActivityAge,
  EMPTY_FILTERS,
  POSITIVE_ORDER,
  PositiveJunkData,
  PositiveJunkFilters,
  PositiveJunkRow,
  SortKey,
  daysAgo,
  filterRows,
  label,
  restoreTarget,
  selectable,
  shortDate,
  sortRows
} from "@/lib/positiveJunk";

// Filters, list, selection and the restore modal. Pure (data comes in as a prop) so it can be
// previewed with sample data; app/admin/positive-junk/page.tsx loads the data.
export default function PositiveJunkBrowser({ data, onReload }: { data: PositiveJunkData; onReload: () => void }) {
  const [filters, setFilters] = useState<PositiveJunkFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortKey>("junked_desc");
  const [selected, setSelected] = useState<string[]>([]);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [now] = useState(() => Date.now());

  const rows = useMemo(() => sortRows(filterRows(data.rows, filters, now), sort), [data, filters, sort, now]);
  const options = useMemo(() => buildOptions(data.rows), [data]);
  const maxBatch = data.max_batch;
  const set = (patch: Partial<PositiveJunkFilters>) => setFilters((f) => ({ ...f, ...patch }));

  function toggle(row: PositiveJunkRow) {
    if (!selectable(row)) return;
    setSelected((s) => {
      if (s.includes(row.lead_id)) return s.filter((id) => id !== row.lead_id);
      if (s.length >= maxBatch) {
        toast.error(`At most ${maxBatch} leads at a time.`);
        return s;
      }
      return [...s, row.lead_id];
    });
  }

  const selectedRows = data.rows.filter((r) => selected.includes(r.lead_id));

  return (
    <>
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
            <Count label="All" value={data.rows.length} active={!filters.highest} onClick={() => set({ highest: "" })} />
            {POSITIVE_ORDER.map((k) => (
              <Count key={k} label={label(k)} value={data.rows.filter((r) => r.highest_positive === k).length} active={filters.highest === k} onClick={() => set({ highest: filters.highest === k ? "" : k })} />
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-md p-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <Field label="Search short id">
                <input value={filters.search} onChange={(e) => set({ search: e.target.value })} placeholder="e.g. 015f262e" className={inputCls} />
              </Field>
              <Select label="Card type" value={filters.cardType} onChange={(v) => set({ cardType: v as PositiveJunkFilters["cardType"] })} options={[["", "All"], ["LEAD", "Lead"], ["DATA", "Data"]]} />
              <Select label="Highest positive" value={filters.highest} onChange={(v) => set({ highest: v as PositiveJunkFilters["highest"] })} options={[["", "All"], ...POSITIVE_ORDER.map((k) => [k, label(k)] as [string, string])]} />
              <Select label="Stage at junk" value={filters.stageAtJunk} onChange={(v) => set({ stageAtJunk: v })} options={[["", "All"], ...options.stages.map((s) => [s, label(s)] as [string, string])]} />
              <Select label="First positive by" value={filters.firstBy} onChange={(v) => set({ firstBy: v })} options={[["", "Anyone"], ...options.firstBy]} />
              <Select label="Last owner" value={filters.lastOwner} onChange={(v) => set({ lastOwner: v })} options={[["", "Anyone"], ...options.lastOwners]} />
              <Field label="Junked from">
                <input type="date" value={filters.junkFrom} onChange={(e) => set({ junkFrom: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Junked to">
                <input type="date" value={filters.junkTo} onChange={(e) => set({ junkTo: e.target.value })} className={inputCls} />
              </Field>
              <Select
                label="Last activity"
                value={filters.activityAge}
                onChange={(v) => set({ activityAge: v as ActivityAge })}
                options={[["", "Any time"], ["LT7", "Under 7 days"], ["7TO14", "7–14 days"], ["14TO30", "14–30 days"], ["30PLUS", "30+ days or none"]]}
              />
              <Select label="Junked by" value={filters.junkedBy} onChange={(v) => set({ junkedBy: v })} options={[["", "All"], ...options.junkedBy.map((s) => [s, s === "SYSTEM" ? "System (auto)" : label(s)] as [string, string])]} />
              <Select label="Recycle count" value={filters.recycleCount} onChange={(v) => set({ recycleCount: v })} options={[["", "Any"], ...options.recycleCounts.map((n) => [n, n] as [string, string])]} />
              <Select label="Project" value={filters.project} onChange={(v) => set({ project: v })} options={[["", "All"], ...options.projects.map((p) => [p, p] as [string, string])]} />
              <Select label="Copy with someone else" value={filters.sibling} onChange={(v) => set({ sibling: v as PositiveJunkFilters["sibling"] })} options={[["", "Any"], ["YES", "Has a positive copy"], ["NO", "No copy"]]} />
              <Select
                label="Sort"
                value={sort}
                onChange={(v) => setSort(v as SortKey)}
                options={[["junked_desc", "Junked: newest"], ["junked_asc", "Junked: oldest"], ["positive", "Highest positive first"], ["activity_recent", "Last activity: newest"], ["first_positive_desc", "First positive: newest"]]}
              />
            </div>
            <div className="flex items-center justify-between gap-2 mt-3">
              <p className="text-sm text-slate-600">
                Showing <b>{rows.length}</b> of {data.rows.length}
              </p>
              <div className="flex items-center gap-3">
                <button onClick={() => setFilters(EMPTY_FILTERS)} className="text-sm font-semibold text-slate-500 hover:text-slate-700">Clear filters</button>
                <button onClick={onReload} className="flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-slate-700">
                  <RefreshCw size={13} /> Refresh
                </button>
              </div>
            </div>
          </div>

          {/* Phone: cards */}
          <div className="sm:hidden space-y-2">
            {rows.map((r) => (
              <RowCard key={r.lead_id} row={r} now={now} checked={selected.includes(r.lead_id)} onToggle={() => toggle(r)} />
            ))}
          </div>

          {/* Wide screens: table */}
          <div className="hidden sm:block bg-white rounded-2xl border border-slate-100 shadow-md">
            <div className="w-0 min-w-full overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                    <th className="p-2 w-8" />
                    <th className="p-2">Lead</th>
                    <th className="p-2">Highest positive</th>
                    <th className="p-2">First positive</th>
                    <th className="p-2">Last owner</th>
                    <th className="p-2 text-right">Recycles</th>
                    <th className="p-2">Junked</th>
                    <th className="p-2">Last activity</th>
                    <th className="p-2">Copy</th>
                    <th className="p-2">Comes back as</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.lead_id} onClick={() => toggle(r)} className={`border-b border-slate-50 align-top ${selectable(r) ? "cursor-pointer hover:bg-slate-50" : "opacity-60"} ${selected.includes(r.lead_id) ? "bg-amber-50/70" : ""}`}>
                      <td className="p-2">
                        <input type="checkbox" checked={selected.includes(r.lead_id)} disabled={!selectable(r)} onChange={() => toggle(r)} onClick={(e) => e.stopPropagation()} />
                      </td>
                      <td className="p-2">
                        <p className="font-mono font-semibold text-slate-800">{r.lead_id8}</p>
                        <p className="text-xs text-slate-400">{r.card_type === "DATA" ? "Data" : "Lead"} · {r.project ?? "—"} · at {label(r.stage_at_junk)}</p>
                        {r.is_data_copy && <p className="text-xs text-slate-500">Data copy of a lead — never restored</p>}
                      </td>
                      <td className="p-2"><PositiveChip kind={r.highest_positive} /></td>
                      <td className="p-2 whitespace-nowrap">
                        <p>{label(r.first_positive)} · {shortDate(r.first_positive_at)}</p>
                        <p className="text-xs text-slate-500">{r.first_positive_by_name ?? "—"}</p>
                      </td>
                      <td className="p-2 whitespace-nowrap">{r.last_owner_name ?? "—"}</td>
                      <td className="p-2 text-right tabular-nums">{r.recycle_count}</td>
                      <td className="p-2 whitespace-nowrap">
                        <p>{shortDate(r.junked_at)}</p>
                        <p className="text-xs text-slate-500">{r.junked_by === "SYSTEM" ? "System" : label(r.junked_by)} · {r.junk_reason}</p>
                      </td>
                      <td className="p-2 whitespace-nowrap">{ageText(r, now)}</td>
                      <td className="p-2 text-xs">{r.sibling ? <span className="text-amber-700">With {r.sibling.owner_name} ({label(r.sibling.stage)})</span> : "—"}</td>
                      <td className="p-2 whitespace-nowrap text-emerald-700">{restoreTarget(r.restore_status, r.restore_stage)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {rows.length === 0 && <p className="text-sm text-slate-400">No leads match these filters.</p>}
        </div>

      {selected.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 shadow-[0_-6px_20px_rgba(15,23,42,0.08)] p-3 flex items-center justify-between gap-2 sm:pl-72">
          <p className="text-sm text-slate-700">
            <b>{selected.length}</b> selected (max {maxBatch})
          </p>
          <div className="flex gap-2">
            <button onClick={() => setSelected([])} className="h-11 px-3 rounded-xl bg-slate-100 text-sm font-semibold text-slate-600 flex items-center gap-1">
              <X size={14} /> Clear
            </button>
            <button onClick={() => setRestoreOpen(true)} className="h-11 px-4 rounded-xl bg-slate-900 text-white text-sm font-semibold flex items-center gap-1">
              <RotateCcw size={14} /> Restore and assign
            </button>
          </div>
        </div>
      )}

      {restoreOpen && (
        <PositiveJunkRestoreModal
          rows={selectedRows}
          employees={data.employees}
          protectionDays={data.protection_days}
          onClose={() => setRestoreOpen(false)}
          onDone={() => {
            setRestoreOpen(false);
            onReload();
          }}
        />
      )}
    </>
  );
}

const inputCls = "w-full h-10 rounded-xl bg-slate-50 border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-amber-200";

function ageText(r: PositiveJunkRow, now: number): string {
  const d = daysAgo(r.last_activity_at, now);
  return d === null ? "None recorded" : d === 0 ? "Today" : `${d} days ago`;
}

function buildOptions(rows: PositiveJunkRow[]) {
  const uniq = <T,>(xs: T[]) => Array.from(new Set(xs));
  const people = (pairs: [string | null, string | null][]) =>
    uniq(pairs.filter(([id]) => id).map(([id, name]) => `${id}|${name ?? "Unknown"}`))
      .map((s) => s.split("|") as [string, string])
      .sort((a, b) => a[1].localeCompare(b[1]));
  return {
    stages: uniq(rows.map((r) => r.stage_at_junk)).sort(),
    firstBy: people(rows.map((r) => [r.first_positive_by, r.first_positive_by_name])),
    lastOwners: people(rows.map((r) => [r.last_owner_id, r.last_owner_name])),
    junkedBy: uniq(rows.map((r) => r.junked_by)).sort(),
    recycleCounts: uniq(rows.map((r) => String(r.recycle_count))).sort(),
    projects: uniq(rows.map((r) => r.project ?? "").filter(Boolean)).sort()
  };
}

function Field({ label: text, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-500 block mb-1">{text}</span>
      {children}
    </label>
  );
}

function Select({ label: text, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <Field label={text}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </Field>
  );
}

function Count({ label: text, value, active, onClick }: { label: string; value: number; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`rounded-2xl border p-3 text-left ${active ? "border-amber-300 bg-amber-50" : "border-slate-100 bg-white"}`}>
      <p className="text-xs font-semibold text-slate-500">{text}</p>
      <p className="text-2xl font-bold text-slate-800 tabular-nums">{value}</p>
    </button>
  );
}

const CHIP: Record<string, string> = {
  BOOKING: "bg-emerald-100 text-emerald-800",
  VISIT: "bg-teal-100 text-teal-800",
  CONVERTED: "bg-amber-100 text-amber-800",
  FOLLOW_UP: "bg-sky-100 text-sky-800",
  CONNECTED: "bg-slate-100 text-slate-700"
};

function PositiveChip({ kind }: { kind: string }) {
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${CHIP[kind] ?? CHIP.CONNECTED}`}>{label(kind)}</span>;
}

function RowCard({ row: r, now, checked, onToggle }: { row: PositiveJunkRow; now: number; checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!selectable(r)}
      className={`w-full text-left rounded-2xl border p-3 bg-white ${checked ? "border-amber-400 ring-2 ring-amber-200" : "border-slate-200"} ${selectable(r) ? "" : "opacity-60"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <input type="checkbox" readOnly checked={checked} disabled={!selectable(r)} />
          <span className="font-mono font-semibold text-slate-900">{r.lead_id8}</span>
          <PositiveChip kind={r.highest_positive} />
        </span>
        <span className="text-xs text-slate-400">{r.card_type === "DATA" ? "Data" : "Lead"}</span>
      </div>
      <p className="text-sm text-slate-600 mt-1">{r.project ?? "—"} · junked {shortDate(r.junked_at)} at {label(r.stage_at_junk)} · {r.junk_reason}</p>
      <p className="text-sm text-slate-700 mt-0.5">
        First {label(r.first_positive)} by <b>{r.first_positive_by_name ?? "—"}</b> on {shortDate(r.first_positive_at)}
      </p>
      <p className="text-sm text-slate-500 mt-0.5">
        Last owner {r.last_owner_name ?? "—"} · {r.recycle_count} recycles · last activity {ageText(r, now).toLowerCase()}
      </p>
      {r.sibling && <p className="text-sm text-amber-700 mt-0.5">Positive copy with {r.sibling.owner_name} ({label(r.sibling.stage)})</p>}
      {r.is_data_copy && <p className="text-sm text-slate-500 mt-0.5">Data copy of a lead — never restored</p>}
      <p className="text-sm text-emerald-700 mt-0.5">Comes back as {restoreTarget(r.restore_status, r.restore_stage)}</p>
    </button>
  );
}
