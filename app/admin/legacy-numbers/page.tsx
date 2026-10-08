"use client";

// Legacy Numbers (2026-10-08). Admin uploads an employee's old sheet
// (.xlsx / .csv); it is parsed IN THE BROWSER. Only each tab's MOBILE
// column is read (auto-detected for header and headerless tabs; the Admin
// can change it). Only the normalized mobile + the tab name (plus the
// employee and file name) are sent to save_legacy_numbers — preview first,
// then confirm. No other column is read, shown or sent, and no cell values
// are displayed — only counts. project / status / visit_done are left
// empty on the server (the RPC treats missing fields as null / false).

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import PageHeader from "@/components/PageHeader";
import {
  detectLegacyMobileColumn,
  isHeaderlessFirstRow,
  legacyMobileColumnStats,
  normalizeLegacyMobile,
  type LegacyMobileKind
} from "@/lib/legacyNumbers";

interface Tab {
  name: string;
  hasHeader: boolean;       // auto-detected (first row holding a number is always data)
  headers: string[];        // labels from the first row (header tabs only) — never data values
  matrix: string[][];       // all non-empty rows (kept in the browser only)
  width: number;
  include: boolean;
  mobileCol: number;
  autoMobileCol: number;
}

interface ServerPreview {
  received: number;
  rejected_invalid: number;
  unique_valid: number;
  merged_duplicates_in_upload: number;
  already_for_this_employee: number;
  in_other_employees_register: number;
  match_active_lead: number;
  employee_existing_rows: number;
  would_remove: number;
}

interface Batch {
  id: string;
  mode: string;
  source_file: string | null;
  rows_received: number;
  rows_inserted: number;
  rows_updated: number;
  rows_removed: number;
  rows_rejected: number;
  created_at: string;
  employee: { name: string | null } | null;
  creator: { name: string | null } | null;
}

const MAX_COLS = 30;
const cellText = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as { text?: unknown; richText?: { text: string }[]; result?: unknown };
    if (o.text != null) return String(o.text);
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if (o.result != null) return String(o.result);
    return "";
  }
  return String(v);
};

function buildTab(name: string, matrix: string[][]): Tab | null {
  const nonEmpty = matrix.filter((r) => r.some((c) => c.trim()));
  if (nonEmpty.length === 0) return null;
  const width = Math.min(MAX_COLS, Math.max(...nonEmpty.map((r) => r.length)));
  const { hasHeader, mobileCol } = detectLegacyMobileColumn(nonEmpty);
  const headerOk = hasHeader && !isHeaderlessFirstRow(nonEmpty[0]);
  return {
    name,
    hasHeader: headerOk,
    headers: Array.from({ length: width }, (_, i) => (headerOk ? (nonEmpty[0][i] || "").trim() : "")),
    matrix: nonEmpty,
    width,
    include: true,
    mobileCol,
    autoMobileCol: mobileCol
  };
}

const dataRows = (tab: Tab) => (tab.hasHeader ? tab.matrix.slice(1) : tab.matrix);
const colLabel = (tab: Tab, i: number) => (tab.hasHeader && tab.headers[i] ? `${tab.headers[i]} (col ${i + 1})` : `Col ${i + 1}`);

export default function LegacyNumbersPage() {
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [fileName, setFileName] = useState("");
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [parsing, setParsing] = useState(false);
  const [mode, setMode] = useState<"ADD" | "REPLACE">("ADD");
  const [preview, setPreview] = useState<ServerPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [registerTotal, setRegisterTotal] = useState<number | null>(null);

  async function loadMeta() {
    const [{ data: emp }, { data: b }, { count }] = await Promise.all([
      supabase.from("employees").select("id, name").eq("is_active", true).order("name"),
      supabase
        .from("legacy_import_batches")
        .select("id, mode, source_file, rows_received, rows_inserted, rows_updated, rows_removed, rows_rejected, created_at, employee:employees!legacy_import_batches_employee_id_fkey(name), creator:employees!legacy_import_batches_created_by_fkey(name)")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("legacy_numbers").select("id", { count: "exact", head: true })
    ]);
    setEmployees((emp as { id: string; name: string }[]) || []);
    setBatches((b as unknown as Batch[]) || []);
    setRegisterTotal(count ?? null);
  }

  useEffect(() => {
    loadMeta();
  }, []);

  async function onFile(file: File) {
    setParsing(true);
    setPreview(null);
    setFileName(file.name);
    try {
      const parsed: Tab[] = [];
      if (/\.csv$/i.test(file.name)) {
        const Papa = (await import("papaparse")).default;
        const result = Papa.parse<string[]>(await file.text(), { skipEmptyLines: true });
        const tab = buildTab("CSV", (result.data as string[][]).map((r) => r.map((c) => String(c ?? ""))));
        if (tab) parsed.push(tab);
      } else {
        const ExcelJS = (await import("exceljs")).default;
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(await file.arrayBuffer());
        wb.eachSheet((ws) => {
          const matrix: string[][] = [];
          ws.eachRow({ includeEmpty: false }, (row) => {
            matrix.push((row.values as unknown[]).slice(1, MAX_COLS + 1).map(cellText));
          });
          const tab = buildTab(ws.name, matrix);
          if (tab) parsed.push(tab);
        });
      }
      setTabs(parsed);
      if (parsed.length === 0) toast.error("No data found in this file.");
    } catch {
      toast.error("Could not read this file. Use .xlsx or .csv.");
    } finally {
      setParsing(false);
    }
  }

  function updateTab(i: number, patch: Partial<Tab>) {
    setPreview(null);
    setTabs((prev) => prev.map((t, k) => (k === i ? { ...t, ...patch } : t)));
  }

  // Per-tab counts + the payload: normalized mobile + tab name only.
  const built = useMemo(() => {
    const perTab = new Map<string, Record<LegacyMobileKind, number>>();
    const payload: { mobile: string; source_tab: string }[] = [];
    const seen = new Set<string>();
    let repeats = 0;
    for (const tab of tabs) {
      if (!tab.include || tab.mobileCol < 0) continue;
      const counts = { blank: 0, valid: 0, normalized_spaces: 0, normalized_plus91: 0, normalized_leading0: 0, multiple: 0, bad: 0 } as Record<LegacyMobileKind, number>;
      for (const row of dataRows(tab)) {
        const { kind, numbers } = normalizeLegacyMobile(row[tab.mobileCol]);
        counts[kind]++;
        for (const mobile of numbers) {
          if (seen.has(mobile)) repeats++;
          seen.add(mobile);
          payload.push({ mobile, source_tab: tab.name.slice(0, 60) });
        }
      }
      perTab.set(tab.name, counts);
    }
    return { perTab, payload, repeats, unique: seen.size };
  }, [tabs]);

  async function callRpc(confirm: boolean) {
    return supabase.rpc("save_legacy_numbers", {
      p_employee_id: employeeId, p_mode: mode, p_source_file: fileName, p_rows: built.payload, p_confirm: confirm
    });
  }

  async function runPreview() {
    if (!employeeId) return toast.error("Choose the employee whose sheet this is.");
    if (built.payload.length === 0) return toast.error("No numbers to send — check the mobile column of at least one tab.");
    setBusy(true);
    const { data, error } = await callRpc(false);
    setBusy(false);
    if (error) return toast.error(error.message.replace("save_legacy_numbers: ", ""));
    setPreview(data as ServerPreview);
  }

  async function confirmSave() {
    setBusy(true);
    const { data, error } = await callRpc(true);
    setBusy(false);
    if (error) return toast.error(error.message.replace("save_legacy_numbers: ", ""));
    const r = data as { inserted: number; updated: number; removed: number };
    toast.success(`Saved: ${r.inserted} added, ${r.updated} updated, ${r.removed} removed.`);
    setTabs([]);
    setFileName("");
    setPreview(null);
    loadMeta();
  }

  const select = "h-9 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs outline-none";

  return (
    <div className="max-w-5xl space-y-5">
      <PageHeader
        eyebrow="Leads"
        title="Legacy Numbers"
        description="Employees ki purani sheets ke numbers ka register. File browser mein hi padhi jaati hai — server ko sirf normalized mobile aur tab ka naam jaata hai; koi aur column nahi."
      />

      <div className="bg-white rounded-2xl border border-slate-100 shadow-md p-5 space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-xs font-semibold text-slate-500 space-y-1">
            <span>Employee (whose sheet)</span>
            <select value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setPreview(null); }} className={`w-full ${select} h-10`}>
              <option value="">Choose…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-500 space-y-1">
            <span>Sheet (.xlsx or .csv)</span>
            <input type="file" accept=".xlsx,.csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} className="block w-full text-xs" />
          </label>
        </div>
        {parsing && <Loader2 size={16} className="animate-spin text-slate-400" />}

        {tabs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-400">
                  <th className="py-1.5 pr-3 font-semibold">Tab</th>
                  <th className="py-1.5 pr-3 font-semibold">Rows</th>
                  <th className="py-1.5 pr-3 font-semibold">Mobile column</th>
                  <th className="py-1.5 pr-3 font-semibold">Valid / fixed / bad</th>
                </tr>
              </thead>
              <tbody>
                {tabs.map((tab, i) => {
                  const counts = built.perTab.get(tab.name);
                  const stats = legacyMobileColumnStats(dataRows(tab), tab.mobileCol);
                  const fixed = counts ? counts.normalized_spaces + counts.normalized_plus91 + counts.normalized_leading0 + counts.multiple : 0;
                  const bad = counts ? counts.bad + counts.blank : 0;
                  return (
                    <tr key={tab.name + i} className={`border-t border-slate-100 align-top ${tab.include ? "text-slate-700" : "text-slate-400"}`}>
                      <td className="py-2 pr-3">
                        <label className="flex items-center gap-2 font-semibold">
                          <input type="checkbox" checked={tab.include} onChange={(e) => updateTab(i, { include: e.target.checked })} />
                          {tab.name}
                        </label>
                        <span className="block text-[11px] text-slate-400">header: {tab.hasHeader ? "haan" : "nahi"} (auto)</span>
                      </td>
                      <td className="py-2 pr-3">{dataRows(tab).length}</td>
                      <td className="py-2 pr-3">
                        <select value={tab.mobileCol} disabled={!tab.include} onChange={(e) => updateTab(i, { mobileCol: Number(e.target.value) })} className={select}>
                          <option value={-1}>— none —</option>
                          {Array.from({ length: tab.width }, (_, c) => <option key={c} value={c}>{colLabel(tab, c)}</option>)}
                        </select>
                        {tab.mobileCol >= 0 && (
                          <span className={`block text-[11px] ${tab.mobileCol === tab.autoMobileCol ? "text-emerald-700" : "text-slate-500"}`}>
                            {tab.mobileCol === tab.autoMobileCol ? "auto-picked ✓" : "manual"} · {Math.round(stats.fillRate * 100)}% bhara · {Math.round(stats.phoneShare * 100)}% number jaise
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {counts && tab.include ? (
                          <>
                            {counts.valid} / {fixed} / {bad}
                            <span className="block text-[11px] text-slate-400">
                              fixed = spaces {counts.normalized_spaces}, +91 {counts.normalized_plus91}, leading 0 {counts.normalized_leading0}, multiple {counts.multiple} · bad = blank {counts.blank}, wrong {counts.bad}
                            </span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {tabs.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
              <span>Numbers to send: <b>{built.payload.length}</b> ({built.unique} unique, {built.repeats} repeated in this file)</span>
              <label className="flex items-center gap-1.5"><input type="radio" checked={mode === "ADD"} onChange={() => { setMode("ADD"); setPreview(null); }} /> Add to this employee&apos;s register</label>
              <label className="flex items-center gap-1.5"><input type="radio" checked={mode === "REPLACE"} onChange={() => { setMode("REPLACE"); setPreview(null); }} /> Replace this employee&apos;s register</label>
            </div>
            {preview && (
              <div className="rounded-xl bg-sky-50 border border-sky-100 p-3 text-sm text-sky-900 space-y-0.5">
                <p className="font-bold">Preview — nothing saved yet</p>
                <p>{preview.unique_valid} unique valid numbers ({preview.merged_duplicates_in_upload} repeats merged, {preview.rejected_invalid} bad numbers).</p>
                <p>Already in this employee&apos;s register: {preview.already_for_this_employee} (they have {preview.employee_existing_rows} now){mode === "REPLACE" ? ` · will be removed: ${preview.would_remove}` : ""}.</p>
                <p>Also in another employee&apos;s register: {preview.in_other_employees_register} · already an active lead in the system: {preview.match_active_lead}.</p>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={runPreview} disabled={busy} className="h-10 px-4 rounded-xl bg-slate-800 text-white text-sm font-bold disabled:opacity-60">Preview</button>
              {preview && (
                <button onClick={confirmSave} disabled={busy} className="h-10 px-4 rounded-xl bg-cyan-500 text-white text-sm font-bold disabled:opacity-60">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : `Confirm ${mode === "REPLACE" ? "replace" : "add"}`}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-md p-5">
        <p className="text-sm font-bold text-slate-800 mb-1">Uploads</p>
        <p className="text-xs text-slate-400 mb-3">Register total: {registerTotal ?? "—"} numbers</p>
        {batches.length === 0 ? (
          <p className="text-xs text-slate-400">No uploads yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-400">
                  <th className="py-1.5 pr-3 font-semibold">When</th>
                  <th className="py-1.5 pr-3 font-semibold">Employee</th>
                  <th className="py-1.5 pr-3 font-semibold">File</th>
                  <th className="py-1.5 pr-3 font-semibold">Mode</th>
                  <th className="py-1.5 pr-3 font-semibold">Received / added / updated / removed / bad</th>
                  <th className="py-1.5 pr-3 font-semibold">By</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-t border-slate-100 text-slate-600">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{new Date(b.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</td>
                    <td className="py-1.5 pr-3">{b.employee?.name || "—"}</td>
                    <td className="py-1.5 pr-3">{b.source_file || "—"}</td>
                    <td className="py-1.5 pr-3 font-semibold">{b.mode}</td>
                    <td className="py-1.5 pr-3">{b.rows_received} / {b.rows_inserted} / {b.rows_updated} / {b.rows_removed} / {b.rows_rejected}</td>
                    <td className="py-1.5 pr-3">{b.creator?.name || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
