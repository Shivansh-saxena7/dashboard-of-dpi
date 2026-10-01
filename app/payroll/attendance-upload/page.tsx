"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import Papa from "papaparse";
import toast from "react-hot-toast";
import { Upload, Download, FileSpreadsheet, CheckCircle2, AlertTriangle, ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import DateInput from "@/components/DateInput";

const VALID_CODES = new Set(["P", "A", "HD", "WO", "L"]);
const LEGEND = "P = Present, A = Absent, HD = Half-Day, WO = Week-Off, L = Leave";

interface EmployeeCodeRow {
  employeeId: string;
  name: string;
  code: string;
  isActive: boolean;
}

interface CellError {
  employeeCode: string;
  employeeName: string;
  date: string;
  message: string;
}

type Step = "UPLOAD" | "PREVIEW" | "RESULT";

function todayMonthStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(yyyyMm: string) {
  const [y, m] = yyyyMm.split("-").map(Number);
  if (!y || !m) return yyyyMm;
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { year: "numeric", month: "long" });
}

function daysInMonthOf(yyyyMm: string) {
  const [y, m] = yyyyMm.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

export default function AttendanceUploadPage() {
  const [month, setMonth] = useState(todayMonthStr());
  const [step, setStep] = useState<Step>("UPLOAD");
  const [employeeCodes, setEmployeeCodes] = useState<Map<string, EmployeeCodeRow>>(new Map());
  const [weeklyOffDay, setWeeklyOffDay] = useState(0);
  const [loadingRefData, setLoadingRefData] = useState(true);

  const [filename, setFilename] = useState("");
  const [parsing, setParsing] = useState(false);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);

  const [errors, setErrors] = useState<CellError[]>([]);
  const [warnings, setWarnings] = useState<CellError[]>([]);
  const [parsedPlan, setParsedPlan] = useState<{ employee_code: string; days: Record<string, string> }[]>([]);

  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ totalRows: number; employeesAffected: number; warnings: CellError[] } | null>(null);

  useEffect(() => {
    loadRefData();
  }, []);

  async function loadRefData() {
    setLoadingRefData(true);
    const [{ data: payrollRows }, { data: settingsRow }] = await Promise.all([
      supabase
        .from("employee_payroll_details")
        .select("employee_id, employee_code, employee:employees!employee_payroll_details_employee_id_fkey(name, is_active)")
        .order("employee_id"),
      supabase.from("lead_engine_settings").select("sla_weekly_off_day").eq("id", 1).single()
    ]);

    const map = new Map<string, EmployeeCodeRow>();
    (payrollRows || []).forEach((r: any) => {
      if (!r.employee_code || !r.employee_code.trim() || !r.employee) return;
      map.set(r.employee_code.trim().toLowerCase(), {
        employeeId: r.employee_id,
        name: r.employee.name,
        code: r.employee_code.trim(),
        isActive: !!r.employee.is_active
      });
    });

    setEmployeeCodes(map);
    setWeeklyOffDay(settingsRow?.sla_weekly_off_day ?? 0);
    setLoadingRefData(false);
  }

  function downloadTemplate() {
    const lastDay = daysInMonthOf(month);
    const dateCols: string[] = [];
    for (let d = 1; d <= lastDay; d++) dateCols.push(`${month}-${String(d).padStart(2, "0")}`);

    const activeCoded = Array.from(employeeCodes.values())
      .filter((e) => e.isActive)
      .sort((a, b) => a.name.localeCompare(b.name));

    if (activeCoded.length === 0) {
      toast.error("No active employees with an Employee Code set yet — set Employee Code in Payroll Details first.");
      return;
    }

    const rows = activeCoded.map((e) => {
      const row: Record<string, string> = { "Employee Code": e.code, "Employee Name": e.name };
      dateCols.forEach((d) => { row[d] = ""; });
      return row;
    });

    // Legend is shown on-page only (below), never appended into the
    // CSV itself — PapaParse would split a free-text trailing line on
    // its own internal commas and assign the fragments positionally to
    // the real columns, producing a phantom "Employee Code not found"
    // row (e.g. "Legend: P = Present") the moment this exact file is
    // re-uploaded. Keep the downloadable file pure data.
    const csv = Papa.unparse(rows);

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-template-${month}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
        setCsvRows(results.data as Record<string, string>[]);
        setParsing(false);
        runValidation(results.data as Record<string, string>[]);
      },
      error: (err: Error) => {
        toast.error("Could not parse this CSV: " + err.message);
        setParsing(false);
      }
    });
  }

  // Mirrors the Edge Function's own validation exactly (same codes,
  // same date range, same weekly-off check) — this is the preview the
  // user acts on; the server re-does this independently as the
  // authoritative, never-trust-the-client check before writing anything.
  function runValidation(rows: Record<string, string>[]) {
    const lastDay = daysInMonthOf(month);
    const foundErrors: CellError[] = [];
    const foundWarnings: CellError[] = [];
    const plan: { employee_code: string; days: Record<string, string> }[] = [];

    // Legend/trailing rows (appended after a blank row in the template)
    // never carry a real Employee Code — skip any row without one
    // rather than erroring, so re-uploading the template unedited past
    // the legend doesn't blow up the preview.
    const dataRows = rows.filter((r) => (r["Employee Code"] || "").trim());

    for (const row of dataRows) {
      const rawCode = (row["Employee Code"] || "").trim();
      const match = employeeCodes.get(rawCode.toLowerCase());

      if (!match) {
        foundErrors.push({ employeeCode: rawCode, employeeName: "", date: "", message: "Employee Code not found" });
        continue;
      }
      if (!match.isActive) {
        foundErrors.push({ employeeCode: rawCode, employeeName: match.name, date: "", message: "Employee is not active" });
        continue;
      }

      const days: Record<string, string> = {};

      for (let d = 1; d <= lastDay; d++) {
        const dateStr = `${month}-${String(d).padStart(2, "0")}`;
        const rawVal = (row[dateStr] || "").trim().toUpperCase();

        if (!rawVal) {
          foundErrors.push({ employeeCode: rawCode, employeeName: match.name, date: dateStr, message: "Missing status for this day" });
          continue;
        }
        if (!VALID_CODES.has(rawVal)) {
          foundErrors.push({ employeeCode: rawCode, employeeName: match.name, date: dateStr, message: `Invalid status code "${row[dateStr]}"` });
          continue;
        }
        if (rawVal === "WO") {
          const weekday = new Date(Number(month.split("-")[0]), Number(month.split("-")[1]) - 1, d).getDay();
          if (weekday !== weeklyOffDay) {
            foundWarnings.push({ employeeCode: rawCode, employeeName: match.name, date: dateStr, message: "Marked Week-Off but this isn't the configured weekly-off day" });
          }
        }
        days[dateStr] = rawVal;
      }

      plan.push({ employee_code: rawCode, days });
    }

    if (dataRows.length === 0) {
      toast.error("No rows found in this file.");
      return;
    }

    setErrors(foundErrors);
    setWarnings(foundWarnings);
    setParsedPlan(plan);
    setStep("PREVIEW");
  }

  async function handleConfirmImport() {
    if (errors.length > 0) {
      toast.error("Fix the highlighted errors before importing.");
      return;
    }

    setImporting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Your session has expired — please log in again.");
        return;
      }

      const res = await fetch(
        "https://inmxkanrwcjlgajqpcuf.supabase.co/functions/v1/bulk-attendance-upload",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ pay_period: month, rows: parsedPlan, filename })
        }
      );

      const body = await res.json();

      if (!body.success) {
        toast.error(body.message || "Import failed.");
        if (Array.isArray(body.errors)) setErrors(body.errors);
        return;
      }

      setResult({ totalRows: body.totalRows, employeesAffected: body.employeesAffected, warnings: body.warnings || [] });
      setStep("RESULT");
      toast.success("Attendance imported.");
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong importing attendance.");
    } finally {
      setImporting(false);
    }
  }

  function resetWizard() {
    setStep("UPLOAD");
    setCsvRows([]);
    setErrors([]);
    setWarnings([]);
    setParsedPlan([]);
    setFilename("");
    setResult(null);
  }

  const perEmployeeSummary = Array.from(
    parsedPlan.reduce((map, p) => {
      const errCount = errors.filter((e) => e.employeeCode === p.employee_code).length;
      map.set(p.employee_code, { code: p.employee_code, days: Object.keys(p.days).length, errors: errCount });
      return map;
    }, new Map<string, { code: string; days: number; errors: number }>())
  ).map(([, v]) => v);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Bulk Attendance Upload</h1>
          <p className="text-sm text-slate-500">Upload a full month's attendance from your register instead of day-by-day entry.</p>
        </div>
        <Link href="/payroll/salary" className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-700">
          <ArrowLeft size={14} /> Back to Salary
        </Link>
      </div>

      {step === "UPLOAD" && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-500">Month</label>
            <div className="w-full sm:w-56 mt-1">
              <DateInput value={month} onChange={setMonth} mode="month" />
            </div>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <button
              onClick={downloadTemplate}
              disabled={loadingRefData}
              className="h-10 px-4 rounded-xl bg-slate-800 text-white text-xs font-bold disabled:opacity-40 hover:bg-slate-900 transition flex items-center gap-1.5"
            >
              <Download size={14} /> Download Template — {monthLabel(month)}
            </button>

            <label className="h-10 px-4 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition flex items-center gap-1.5 cursor-pointer">
              <Upload size={14} /> {parsing ? "Parsing..." : "Upload Filled Template"}
              <input type="file" accept=".csv" onChange={handleFileSelect} className="hidden" disabled={parsing} />
            </label>
          </div>

          <p className="text-xs text-slate-500">
            One row per employee (matched by Employee Code), one column per day. Status codes: <span className="font-semibold text-slate-700">{LEGEND}</span>.
            Re-uploading the same month corrects any mistakes instead of creating duplicates.
          </p>
        </div>
      )}

      {step === "PREVIEW" && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <FileSpreadsheet size={15} /> Preview — {filename}
              </p>
              <div className="flex items-center gap-2">
                {errors.length > 0 ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-red-50 text-red-700">
                    <AlertTriangle size={12} /> {errors.length} error{errors.length === 1 ? "" : "s"}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700">
                    <CheckCircle2 size={12} /> No errors
                  </span>
                )}
                {warnings.length > 0 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700">
                    <AlertTriangle size={12} /> {warnings.length} warning{warnings.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            </div>

            <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
              {perEmployeeSummary.map((e) => (
                <div key={e.code} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-1.5 sm:gap-3 sm:items-center py-2">
                  <span className="text-sm font-semibold text-slate-700">{e.code}</span>
                  <span className="text-xs text-slate-500 w-fit sm:w-28">{e.days} day(s) parsed</span>
                  <span
                    className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[11px] font-bold w-fit sm:w-24 ${
                      e.errors > 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {e.errors > 0 ? `${e.errors} error(s)` : "OK"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {(errors.length > 0 || warnings.length > 0) && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-2 overflow-x-auto">
              <p className="text-sm font-bold text-slate-800">Details</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400 font-bold">
                    <th className="py-1.5 pr-3">Employee Code</th>
                    <th className="py-1.5 pr-3">Date</th>
                    <th className="py-1.5 pr-3">Issue</th>
                  </tr>
                </thead>
                <tbody>
                  {[...errors.map((e) => ({ ...e, kind: "error" as const })), ...warnings.map((w) => ({ ...w, kind: "warning" as const }))].map((row, i) => (
                    <tr key={i} className="border-t border-slate-50">
                      <td className="py-1.5 pr-3 font-semibold text-slate-700">{row.employeeCode || "—"}</td>
                      <td className="py-1.5 pr-3 text-slate-500">{row.date || "—"}</td>
                      <td className={`py-1.5 pr-3 font-semibold ${row.kind === "error" ? "text-red-600" : "text-amber-600"}`}>{row.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap gap-2.5">
            <button
              onClick={handleConfirmImport}
              disabled={importing || errors.length > 0}
              className="h-10 px-5 rounded-xl bg-emerald-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-emerald-700 transition"
            >
              {importing ? "Importing..." : "Confirm & Import"}
            </button>
            <button onClick={resetWizard} disabled={importing} className="h-10 px-4 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold hover:bg-slate-200 transition">
              Start Over
            </button>
          </div>
        </div>
      )}

      {step === "RESULT" && result && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 text-emerald-700">
            <CheckCircle2 size={20} />
            <p className="text-sm font-bold">Attendance imported for {monthLabel(month)}</p>
          </div>
          <p className="text-sm text-slate-600">
            {result.totalRows} row(s) processed across {result.employeesAffected} employee(s).
          </p>
          {result.warnings.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-bold text-amber-700">{result.warnings.length} warning(s):</p>
              {result.warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-600">
                  {w.employeeCode} — {w.date}: {w.message}
                </p>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2.5">
            <Link href="/payroll/salary" className="h-10 px-4 rounded-xl bg-slate-800 text-white text-xs font-bold hover:bg-slate-900 transition flex items-center">
              Go to Salary Page
            </Link>
            <button onClick={resetWizard} className="h-10 px-4 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold hover:bg-slate-200 transition">
              Upload Another Month
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
