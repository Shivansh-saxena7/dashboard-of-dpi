"use client";

import { useEffect, useState } from "react";
import Papa from "papaparse";
import { motion } from "framer-motion";
import Link from "next/link";
import toast from "react-hot-toast";
import { ArrowLeft, Upload, ChevronDown, Loader2, CheckCircle2, AlertTriangle, RotateCcw, Trash2, Download } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { normalizeMobile } from "@/lib/normalizeMobile";
import { guessFieldForHeader, MAPPED_FIELD_OPTIONS, MappedField } from "@/lib/csvFieldMatcher";
import DeleteModal from "../../components/DeleteModal";

const NEW_SOURCE_SENTINEL = "__new__";

type WizardStep = "UPLOAD" | "MAP" | "PREVIEW" | "RESULT";

interface MappedRow {
  name: string;
  mobile: string;
  email: string | null;
  project: string | null;
  source: string | null;
  extra_data: Record<string, string> | null;
  isValid: boolean;
  isDuplicate: boolean;
}

function FilterSelect({
  value,
  onChange,
  children,
  className = ""
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select
        value={value}
        onChange={onChange}
        className="appearance-none w-full h-11 rounded-xl bg-white border border-slate-200 pl-3 pr-8 text-sm font-medium text-slate-700 outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 transition"
      >
        {children}
      </select>
      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
    </div>
  );
}

const STEPS: { key: WizardStep; label: string }[] = [
  { key: "UPLOAD", label: "Upload" },
  { key: "MAP", label: "Map Columns" },
  { key: "PREVIEW", label: "Preview" },
  { key: "RESULT", label: "Done" }
];

// Admin-only Smart CSV Import (V2_MASTER_BLUEPRINT Section 4.2). A
// 4-step wizard rather than a modal — mapping/preview genuinely needs
// the room. Distribution itself is entirely owned by the
// import-leads-csv Edge Function (same calculateLeadAssignment +
// assign_lead_atomic path assign-lead/recycle-stale-leads use) — this
// page only builds the row payload and shows the result; it never
// touches lead_engine_settings or the round-robin pointer directly.
export default function ImportLeadsPage() {

  const [step, setStep] = useState<WizardStep>("UPLOAD");

  const [sourceOptions, setSourceOptions] = useState<string[]>([]);
  const [sourceSelect, setSourceSelect] = useState("");
  const [newSourceName, setNewSourceName] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [filename, setFilename] = useState("");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [parsing, setParsing] = useState(false);

  const [mapping, setMapping] = useState<Record<string, MappedField>>({});
  const [loadingMapping, setLoadingMapping] = useState(false);

  const [mappedRows, setMappedRows] = useState<MappedRow[]>([]);
  const [buildingPreview, setBuildingPreview] = useState(false);
  const [importing, setImporting] = useState(false);

  const [result, setResult] = useState<any>(null);
  const [employeeNames, setEmployeeNames] = useState<Map<string, string>>(new Map());

  const [batches, setBatches] = useState<any[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [retryingBatchId, setRetryingBatchId] = useState<string | null>(null);
  const [deleteModalBatchId, setDeleteModalBatchId] = useState<string | null>(null);
  const [deletingBatch, setDeletingBatch] = useState(false);

  const [eligibleEmployeeCount, setEligibleEmployeeCount] = useState<number | null>(null);

  useEffect(() => {
    loadSourceOptions();
    loadEmployeeNames();
    loadBatches();
  }, []);

  async function loadSourceOptions() {
    const { data } = await supabase.from("leads").select("source");
    const distinct = Array.from(new Set((data || []).map((l) => l.source).filter(Boolean))) as string[];
    setSourceOptions(distinct.sort());
  }

  async function loadEmployeeNames() {
    const { data } = await supabase.from("employees").select("id, name");
    const map = new Map<string, string>();
    (data || []).forEach((e) => map.set(e.id, e.name));
    setEmployeeNames(map);
  }

  async function loadBatches() {
    setLoadingBatches(true);

    const { data } = await supabase
      .from("csv_import_batches")
      .select("id, source_name, filename, uploaded_at, total_rows, duplicate_count, imported_count, assigned_count, status")
      .order("uploaded_at", { ascending: false })
      .limit(20);

    setBatches(data || []);
    setLoadingBatches(false);
  }

  async function handleRetryDistribution(batchId: string) {
    setRetryingBatchId(batchId);

    try {

      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        toast.error("Your session has expired — please log in again.");
        return;
      }

      const res = await fetch(
        "https://inmxkanrwcjlgajqpcuf.supabase.co/functions/v1/retry-lead-distribution",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ batch_id: batchId })
        }
      );

      const data = await res.json();

      if (!data.success) {
        toast.error(data.message || "Retry failed.");
        return;
      }

      toast.success(
        data.assignedCount > 0
          ? `Assigned ${data.assignedCount} more lead${data.assignedCount === 1 ? "" : "s"}.`
          : data.message || "No leads could be assigned right now."
      );

      loadBatches();

    } catch (err) {
      console.log(err);
      toast.error("Something went wrong retrying distribution.");
    } finally {
      setRetryingBatchId(null);
    }
  }

  async function handleDeleteBatch() {
    if (!deleteModalBatchId) return;

    setDeletingBatch(true);

    try {

      const { error } = await supabase.rpc("delete_csv_batch_atomic", {
        p_batch_id: deleteModalBatchId
      });

      if (error) {
        toast.error(error.message || "Could not delete this batch.");
        return;
      }

      toast.success("Batch deleted.");
      setDeleteModalBatchId(null);
      loadBatches();

    } catch (err) {
      console.log(err);
      toast.error("Something went wrong deleting this batch.");
    } finally {
      setDeletingBatch(false);
    }
  }

  // Pre-import awareness — checked once Preview is reached, not a
  // blocker. Same "today's attendance + is_active/rr_eligible" shape
  // the backend itself uses, so the count Admin sees here matches
  // what the Edge Function will actually find.
  async function checkEligibility() {
    const today = new Date().toISOString().split("T")[0];

    const [{ data: todaysAttendance }, { data: allEligible }] = await Promise.all([
      supabase.from("attendance").select("employee_id").eq("date", today).is("shift_end_at", null),
      supabase.from("employees").select("id").eq("is_active", true).eq("rr_eligible", true)
    ]);

    const shiftStarted = new Set((todaysAttendance || []).map((a) => a.employee_id));
    const eligible = (allEligible || []).filter((e) => shiftStarted.has(e.id));

    setEligibleEmployeeCount(eligible.length);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setParsing(true);
    setFilename(file.name);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setCsvHeaders(results.meta.fields || []);
        setCsvRows(results.data as Record<string, string>[]);
        setParsing(false);
      },
      error: (err: Error) => {
        toast.error("Could not parse this CSV: " + err.message);
        setParsing(false);
      }
    });
  }

  async function proceedToMapping() {
    const finalSource = sourceSelect === NEW_SOURCE_SENTINEL ? newSourceName.trim() : sourceSelect;

    if (!finalSource) {
      toast.error("Select or enter a source.");
      return;
    }

    if (csvHeaders.length === 0) {
      toast.error("Upload a CSV first.");
      return;
    }

    setSourceName(finalSource);
    setLoadingMapping(true);

    // Remembered mapping (from a prior import of this same source)
    // wins over a fresh guess — this is what lets repeat imports skip
    // re-mapping entirely.
    const { data: remembered } = await supabase
      .from("csv_import_mappings")
      .select("column_header, mapped_field")
      .eq("source_name", finalSource);

    const rememberedMap = new Map<string, MappedField>();
    (remembered || []).forEach((r) => rememberedMap.set(r.column_header, r.mapped_field as MappedField));

    const initialMapping: Record<string, MappedField> = {};
    csvHeaders.forEach((h) => {
      initialMapping[h] = rememberedMap.get(h) || guessFieldForHeader(h);
    });

    setMapping(initialMapping);
    setLoadingMapping(false);
    setStep("MAP");
  }

  async function confirmMapping() {
    const upsertRows = Object.entries(mapping)
      .filter(([, field]) => field !== "ignore")
      .map(([column_header, mapped_field]) => ({
        source_name: sourceName,
        column_header,
        mapped_field
      }));

    if (upsertRows.length > 0) {
      await supabase
        .from("csv_import_mappings")
        .upsert(upsertRows, { onConflict: "source_name,column_header" });
    }

    setBuildingPreview(true);

    const built = csvRows.map((row) => {
      let name = "";
      let mobile = "";
      let email: string | null = null;
      let project: string | null = null;
      let source: string | null = null;
      const extra: Record<string, string> = {};

      Object.entries(mapping).forEach(([header, field]) => {
        const value = (row[header] || "").trim();
        if (!value) return;

        if (field === "name") name = value;
        else if (field === "mobile") mobile = value;
        else if (field === "email") email = value;
        else if (field === "project") project = value;
        else if (field === "source") source = value;
        else if (field === "lead_time") extra.original_lead_time = value;
        else if (field === "extra") extra[header] = value;
      });

      // Mobile is the only genuinely required field — it's what
      // actually lets an employee call the lead. Name missing is a
      // data-quality gap, not a reason to drop the row entirely, so
      // it defaults to "Unknown" rather than blocking import.
      return {
        name: name || "Unknown",
        mobile,
        email,
        project,
        source,
        extra_data: Object.keys(extra).length > 0 ? extra : null,
        isValid: Boolean(mobile)
      };
    });

    // Preview-only duplicate detection (informational) — the actual
    // import always re-checks server-side (import-leads-csv is
    // authoritative), so a narrow race here between preview and
    // submit is expected and harmless.
    const { data: existing } = await supabase.from("leads").select("mobile");
    const existingNormalized = new Set((existing || []).map((l) => normalizeMobile(l.mobile)));

    const seen = new Set<string>();

    const finalRows: MappedRow[] = built.map((row) => {
      if (!row.isValid) return { ...row, isDuplicate: false };

      const norm = normalizeMobile(row.mobile);
      const isDuplicate = existingNormalized.has(norm) || seen.has(norm);
      seen.add(norm);

      return { ...row, isDuplicate };
    });

    setMappedRows(finalRows);
    await checkEligibility();
    setBuildingPreview(false);
    setStep("PREVIEW");
  }

  // Rejected-row content only exists in memory for this session —
  // csv_import_batches only ever stores aggregate counts, never the
  // actual row data — so this export is only offered here, right
  // after building the preview, not retroactively from Import History.
  function downloadFailedRows() {
    const failedIndexes = mappedRows
      .map((row, i) => (!row.isValid ? i : -1))
      .filter((i) => i !== -1);

    if (failedIndexes.length === 0) {
      toast.error("No failed rows to export.");
      return;
    }

    const exportRows = failedIndexes.map((i) => ({
      ...csvRows[i],
      Reason: "Missing mobile"
    }));

    const csv = Papa.unparse(exportRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `failed-rows-${sourceName || "import"}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleImport() {
    setImporting(true);

    try {

      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        toast.error("Your session has expired — please log in again.");
        return;
      }

      const rowsToSend = mappedRows
        .filter((r) => r.isValid)
        .map((r) => ({
          name: r.name,
          mobile: r.mobile,
          email: r.email,
          project: r.project,
          source: r.source,
          extra_data: r.extra_data
        }));

      const res = await fetch(
        "https://inmxkanrwcjlgajqpcuf.supabase.co/functions/v1/import-leads-csv",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ rows: rowsToSend, source_name: sourceName, filename })
        }
      );

      const data = await res.json();

      if (!data.success) {
        toast.error(data.message || "Import failed.");
        return;
      }

      setResult(data);
      setStep("RESULT");
      loadBatches();
      loadSourceOptions();

    } catch (err) {
      console.log(err);
      toast.error("Something went wrong during import.");
    } finally {
      setImporting(false);
    }
  }

  function startNewImport() {
    setStep("UPLOAD");
    setSourceSelect("");
    setNewSourceName("");
    setSourceName("");
    setFilename("");
    setCsvHeaders([]);
    setCsvRows([]);
    setMapping({});
    setMappedRows([]);
    setResult(null);
    setEligibleEmployeeCount(null);
  }

  const validCount = mappedRows.filter((r) => r.isValid && !r.isDuplicate).length;
  const duplicateCount = mappedRows.filter((r) => r.isValid && r.isDuplicate).length;
  const invalidCount = mappedRows.filter((r) => !r.isValid).length;
  const currentStepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/leads"
          className="h-10 w-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-800 transition"
        >
          <ArrowLeft size={16} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Import Leads</h1>
          <p className="text-sm text-slate-500">Upload a CSV from any source — no fixed header format required</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2 flex-1">
            <div
              className={`h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${
                i <= currentStepIndex ? "bg-gradient-to-br from-blue-600 to-cyan-500 text-white" : "bg-slate-100 text-slate-400"
              }`}
            >
              {i + 1}
            </div>
            <p className={`text-xs font-semibold ${i <= currentStepIndex ? "text-slate-700" : "text-slate-400"}`}>
              {s.label}
            </p>
            {i < STEPS.length - 1 && <div className="flex-1 h-px bg-slate-200" />}
          </div>
        ))}
      </div>

      {step === "UPLOAD" && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-[24px] border border-slate-100 shadow-md p-6 space-y-5">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-bold mb-2">Source</p>
            <div className="flex gap-2">
              <FilterSelect value={sourceSelect} onChange={(e) => setSourceSelect(e.target.value)} className="flex-1">
                <option value="" disabled>Select a source...</option>
                {sourceOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
                <option value={NEW_SOURCE_SENTINEL}>+ Add new source</option>
              </FilterSelect>

              {sourceSelect === NEW_SOURCE_SENTINEL && (
                <input
                  value={newSourceName}
                  onChange={(e) => setNewSourceName(e.target.value)}
                  placeholder="e.g. 99Acres"
                  className="flex-1 h-11 rounded-xl bg-white border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                />
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5">
              Column mappings are remembered per source — picking the same source next time skips re-mapping.
            </p>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-bold mb-2">CSV File</p>
            <label className="flex flex-col items-center justify-center gap-2 h-32 rounded-xl border-2 border-dashed border-slate-200 hover:border-blue-300 cursor-pointer transition">
              <Upload size={20} className="text-slate-400" />
              <span className="text-sm text-slate-500">
                {filename || "Click to choose a .csv file"}
              </span>
              <input type="file" accept=".csv" onChange={handleFileSelect} className="hidden" />
            </label>
            {csvRows.length > 0 && (
              <p className="text-[11px] text-emerald-600 font-medium mt-1.5">
                {csvRows.length} rows detected, {csvHeaders.length} columns.
              </p>
            )}
          </div>

          <button
            onClick={proceedToMapping}
            disabled={parsing || loadingMapping || csvRows.length === 0}
            className="h-11 px-6 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 to-cyan-500 disabled:opacity-50 flex items-center gap-2"
          >
            {loadingMapping ? <Loader2 className="animate-spin" size={16} /> : null}
            Continue to Mapping
          </button>
        </motion.div>
      )}

      {step === "MAP" && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-[24px] border border-slate-100 shadow-md p-6 space-y-4">
          <p className="text-sm text-slate-500">
            Confirm what each column means. Recognized columns are pre-filled — adjust anything that's wrong.
          </p>

          <div className="space-y-2 max-h-[480px] overflow-y-auto">
            {csvHeaders.map((header) => (
              <div key={header} className="flex items-center gap-3 rounded-xl bg-slate-50 border border-slate-100 p-3">
                <p className="text-sm font-semibold text-slate-700 flex-1 truncate">{header}</p>
                <FilterSelect
                  value={mapping[header] || "ignore"}
                  onChange={(e) => setMapping((prev) => ({ ...prev, [header]: e.target.value as MappedField }))}
                  className="w-52"
                >
                  {MAPPED_FIELD_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </FilterSelect>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setStep("UPLOAD")}
              className="h-11 px-5 rounded-xl font-semibold text-slate-600 border border-slate-200"
            >
              Back
            </button>
            <button
              onClick={confirmMapping}
              disabled={buildingPreview}
              className="h-11 px-6 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 to-cyan-500 disabled:opacity-50 flex items-center gap-2"
            >
              {buildingPreview ? <Loader2 className="animate-spin" size={16} /> : null}
              Continue to Preview
            </button>
          </div>
        </motion.div>
      )}

      {step === "PREVIEW" && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-[24px] border border-slate-100 shadow-md p-6 space-y-4">
          {eligibleEmployeeCount === 0 && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-100 p-3">
              <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                Abhi koi employee shift-started nahi hai — leads unassigned reh jayengi. Import ke baad, jab koi shift start kare, "Retry Distribution" (Import History mein) use karna hoga.
              </p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-emerald-50 p-4">
              <p className="text-[10px] uppercase tracking-wide text-emerald-600 font-bold">Will Import</p>
              <p className="text-2xl font-bold text-emerald-700 mt-1">{validCount}</p>
            </div>
            <div className="rounded-xl bg-amber-50 p-4">
              <p className="text-[10px] uppercase tracking-wide text-amber-600 font-bold">Duplicates (skipped)</p>
              <p className="text-2xl font-bold text-amber-700 mt-1">{duplicateCount}</p>
            </div>
            <div className="rounded-xl bg-red-50 p-4">
              <p className="text-[10px] uppercase tracking-wide text-red-600 font-bold">Missing Mobile</p>
              <p className="text-2xl font-bold text-red-700 mt-1">{invalidCount}</p>
              {invalidCount > 0 && (
                <button
                  onClick={downloadFailedRows}
                  className="flex items-center gap-1 mt-1.5 text-[11px] font-bold text-red-700 hover:text-red-800 transition"
                >
                  <Download size={11} />
                  Download
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto max-h-[420px] overflow-y-auto rounded-xl border border-slate-100">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500">Name</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500">Mobile</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500">Project</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {mappedRows.map((row, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-700">{row.name || "—"}</td>
                    <td className="px-3 py-2 text-slate-700">{row.mobile || "—"}</td>
                    <td className="px-3 py-2 text-slate-500">{row.project || "—"}</td>
                    <td className="px-3 py-2">
                      {!row.isValid ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600">Missing mobile</span>
                      ) : row.isDuplicate ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">Duplicate — will skip</span>
                      ) : (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">Ready</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setStep("MAP")}
              disabled={importing}
              className="h-11 px-5 rounded-xl font-semibold text-slate-600 border border-slate-200 disabled:opacity-50"
            >
              Back
            </button>
            <button
              onClick={handleImport}
              disabled={importing || validCount === 0}
              className="h-11 px-6 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 to-cyan-500 disabled:opacity-50 flex items-center gap-2"
            >
              {importing ? <Loader2 className="animate-spin" size={16} /> : null}
              Import {validCount} Lead{validCount === 1 ? "" : "s"}
            </button>
          </div>
        </motion.div>
      )}

      {step === "RESULT" && result && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-[24px] border border-slate-100 shadow-md p-6 space-y-5">
          <div className="flex items-center gap-2 text-emerald-600">
            <CheckCircle2 size={22} />
            <p className="text-lg font-bold">Import complete</p>
          </div>

          {result.warning && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-100 p-3">
              <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">{result.warning}</p>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-[10px] uppercase tracking-wide text-slate-400 font-bold">Total Rows</p>
              <p className="text-2xl font-bold text-slate-800 mt-1">{result.totalRows}</p>
            </div>
            <div className="rounded-xl bg-emerald-50 p-4">
              <p className="text-[10px] uppercase tracking-wide text-emerald-600 font-bold">Imported</p>
              <p className="text-2xl font-bold text-emerald-700 mt-1">{result.importedCount}</p>
            </div>
            <div className="rounded-xl bg-blue-50 p-4">
              <p className="text-[10px] uppercase tracking-wide text-blue-600 font-bold">Assigned</p>
              <p className="text-2xl font-bold text-blue-700 mt-1">{result.assignedCount}</p>
            </div>
            <div className="rounded-xl bg-amber-50 p-4">
              <p className="text-[10px] uppercase tracking-wide text-amber-600 font-bold">Duplicates Skipped</p>
              <p className="text-2xl font-bold text-amber-700 mt-1">{result.duplicateCount}</p>
            </div>
          </div>

          {result.distributionSummary && Object.keys(result.distributionSummary).length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-bold mb-2">Distribution</p>
              <div className="space-y-1.5">
                {Object.entries(result.distributionSummary).map(([employeeId, count]) => (
                  <div key={employeeId} className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50">
                    <p className="text-sm font-medium text-slate-700">{employeeNames.get(employeeId) || "Unknown"}</p>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                      {count as number} lead{(count as number) === 1 ? "" : "s"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={startNewImport}
            className="h-11 px-6 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 to-cyan-500"
          >
            Start New Import
          </button>
        </motion.div>
      )}

      <div className="bg-white rounded-[24px] border border-slate-100 shadow-md p-6">
        <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-bold mb-3">
          Import History
        </p>

        {loadingBatches ? (
          <p className="text-sm text-slate-400">Loading...</p>
        ) : batches.length === 0 ? (
          <p className="text-sm text-slate-400">No imports yet.</p>
        ) : (
          <div className="space-y-2 max-h-[420px] overflow-y-auto">
            {batches.map((b) => (
              <div key={b.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-50 gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-700 truncate">
                      {b.source_name} {b.filename && <span className="text-slate-400 font-normal">· {b.filename}</span>}
                    </p>
                    {b.status === "deleted" && (
                      <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-500">
                        Deleted
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {new Date(b.uploaded_at).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {b.imported_count}/{b.total_rows} imported · {b.assigned_count} assigned
                  </p>
                </div>

                {b.status === "active" && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    {b.assigned_count < b.imported_count && (
                      <button
                        onClick={() => handleRetryDistribution(b.id)}
                        disabled={retryingBatchId === b.id}
                        title="Retry Distribution"
                        className="h-8 w-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 hover:bg-blue-100 transition disabled:opacity-50"
                      >
                        {retryingBatchId === b.id ? (
                          <Loader2 className="animate-spin" size={13} />
                        ) : (
                          <RotateCcw size={13} />
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => setDeleteModalBatchId(b.id)}
                      title="Delete Batch"
                      className="h-8 w-8 rounded-lg bg-red-50 border border-red-100 flex items-center justify-center text-red-500 hover:bg-red-100 transition"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <DeleteModal
        open={Boolean(deleteModalBatchId)}
        setOpen={(open: boolean) => !open && setDeleteModalBatchId(null)}
        onDelete={handleDeleteBatch}
        title="Delete Import Batch"
        message={
          deletingBatch
            ? "Deleting..."
            : "This deletes every lead from this batch. Leads that have already been worked on (status/board changed, notes added, visited/booked) will block this — the batch record itself always stays, marked as deleted."
        }
      />
    </div>
  );
}
