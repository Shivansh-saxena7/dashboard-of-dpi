"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { IndianRupee, FileText, Download, History, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import DateInput from "@/components/DateInput";
import { buildSalarySlipBlob } from "@/lib/generateHrDocumentPdf";
import { formatINR } from "@/lib/exportTable";

interface EmployeeRow {
  id: string;
  name: string;
  department: string | null;
  role: string;
}

interface CompensationRow {
  id: string;
  basic_pay: number;
  effective_from: string;
  created_at: string;
  set_by: { name: string } | null;
}

interface SlipRow {
  id: string;
  label: string;
  storage_path: string;
  created_at: string;
}

function monthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { year: "numeric", month: "long" });
}

// Effective-dated compensation (Basic Pay = Gross, no allowances yet --
// see HRMS_MASTER_PLAN.md) is its own history table, never a mutable
// column on employees: a raise inserts a new row, it never edits/deletes
// an old one, so a slip generated for a past month always resolves the
// Basic Pay that was actually in effect that month, unaffected by any
// later raise. Generated slip PDFs register into the existing
// hr_documents system as document_type SALARY_SLIP -- same storage/
// viewing path as every other HR document, no parallel system.
export default function HrSalaryPage() {
  const todayStr = new Date().toISOString().slice(0, 10);

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [loading, setLoading] = useState(true);

  const [history, setHistory] = useState<CompensationRow[]>([]);
  const [newBasicPay, setNewBasicPay] = useState("");
  const [newEffectiveFrom, setNewEffectiveFrom] = useState(todayStr);
  const [savingPay, setSavingPay] = useState(false);

  const [slipMonth, setSlipMonth] = useState(todayStr.slice(0, 7));
  const [generating, setGenerating] = useState(false);
  const [slips, setSlips] = useState<SlipRow[]>([]);

  const [signedCopyFile, setSignedCopyFile] = useState<File | null>(null);
  const [signedCopyLabel, setSignedCopyLabel] = useState("");
  const [uploadingSignedCopy, setUploadingSignedCopy] = useState(false);

  useEffect(() => {
    loadEmployees();
  }, []);

  useEffect(() => {
    if (employeeId) {
      loadHistory(employeeId);
      loadSlips(employeeId);
    } else {
      setHistory([]);
      setSlips([]);
    }
  }, [employeeId]);

  async function loadEmployees() {
    const { data } = await supabase.from("employees").select("id, name, department, role").eq("is_active", true).order("name");
    setEmployees(data || []);
    setLoading(false);
  }

  async function loadHistory(empId: string) {
    const { data } = await supabase
      .from("employee_compensation")
      .select("id, basic_pay, effective_from, created_at, set_by:employees!employee_compensation_set_by_employee_id_fkey(name)")
      .eq("employee_id", empId)
      .order("effective_from", { ascending: false });
    setHistory((data || []) as unknown as CompensationRow[]);
  }

  async function loadSlips(empId: string) {
    const { data } = await supabase
      .from("hr_documents")
      .select("id, label, storage_path, created_at")
      .eq("employee_id", empId)
      .eq("document_type", "SALARY_SLIP")
      .order("created_at", { ascending: false });
    setSlips(data || []);
  }

  const currentBasicPay = history.find((h) => h.effective_from <= todayStr)?.basic_pay ?? null;

  async function handleSetBasicPay() {
    const amount = Number(newBasicPay);
    if (!amount || amount <= 0) {
      toast.error("Enter a valid Basic Pay amount.");
      return;
    }
    if (!newEffectiveFrom) {
      toast.error("Pick an effective-from date.");
      return;
    }

    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: me } = await supabase.from("employees").select("id").eq("auth_user_id", user.id).single();
    if (!me) {
      toast.error("Could not identify your employee record.");
      return;
    }

    setSavingPay(true);
    const { error } = await supabase.from("employee_compensation").insert({
      employee_id: employeeId,
      basic_pay: amount,
      effective_from: newEffectiveFrom,
      set_by_employee_id: me.id
    });
    setSavingPay(false);

    if (error) {
      toast.error(error.message || "Could not save Basic Pay.");
      return;
    }

    toast.success("Basic Pay updated.");
    setNewBasicPay("");
    loadHistory(employeeId);
  }

  async function handleGenerateSlip() {
    if (!employeeId) return;
    const employee = employees.find((e) => e.id === employeeId);
    if (!employee) return;

    // Resolve Basic Pay as of the LAST day of the selected month, not
    // today -- generating a slip for a past month must use the pay that
    // was in effect then, unaffected by any raise since.
    const [y, m] = slipMonth.split("-").map(Number);
    const periodEndDate = new Date(y, m, 0).toISOString().slice(0, 10);
    const asOfRow = history.filter((h) => h.effective_from <= periodEndDate).sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0];

    if (!asOfRow) {
      toast.error("No Basic Pay set for this employee as of that month.");
      return;
    }

    setGenerating(true);
    try {
      const periodLabel = monthLabel(slipMonth);
      const blob = await buildSalarySlipBlob({
        employeeName: employee.name,
        department: employee.department,
        role: employee.role,
        periodLabel,
        basicPay: asOfRow.basic_pay
      });

      const storagePath = `${employeeId}/${crypto.randomUUID()}-salary-slip.pdf`;
      const { error: uploadError } = await supabase.storage.from("hr-documents").upload(storagePath, blob, { contentType: "application/pdf" });
      if (uploadError) {
        toast.error(uploadError.message || "Upload failed.");
        return;
      }

      const { error: registerError } = await supabase.rpc("register_hr_document_atomic", {
        p_employee_id: employeeId,
        p_document_type: "SALARY_SLIP",
        p_label: `Salary Slip - ${periodLabel}`,
        p_storage_path: storagePath,
        p_file_mime_type: "application/pdf",
        p_is_generated: true
      });

      if (registerError) {
        await supabase.storage.from("hr-documents").remove([storagePath]);
        toast.error(registerError.message || "Could not save slip record.");
        return;
      }

      toast.success(`Salary slip generated for ${periodLabel}.`);
      loadSlips(employeeId);
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleDownloadSlip(slip: SlipRow) {
    const { data, error } = await supabase.storage.from("hr-documents").createSignedUrl(slip.storage_path, 300);
    if (error || !data) {
      toast.error(error?.message || "Could not generate download link.");
      return;
    }
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.download = `${slip.label}.pdf`;
    a.click();
  }

  // Signed hard-copy upload -- the generated slip above is meant to be
  // printed and physically signed (Accounts + employee), then that
  // signed scan comes back in here as the real record. Same
  // upload-then-register flow as Application Form on the Candidates
  // page, just targeting an employee instead of a candidate.
  async function handleUploadSignedCopy() {
    if (!employeeId) return;
    if (!signedCopyFile) {
      toast.error("Choose a file first.");
      return;
    }
    const label = signedCopyLabel.trim() || `Salary Slip - ${monthLabel(slipMonth)} (Signed)`;

    setUploadingSignedCopy(true);
    try {
      const sanitizedName = signedCopyFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${employeeId}/${crypto.randomUUID()}-${sanitizedName}`;

      const { error: uploadError } = await supabase.storage
        .from("hr-documents")
        .upload(storagePath, signedCopyFile, { contentType: signedCopyFile.type });

      if (uploadError) {
        toast.error(uploadError.message || "Upload failed.");
        return;
      }

      const { error: registerError } = await supabase.rpc("register_hr_document_atomic", {
        p_employee_id: employeeId,
        p_document_type: "SALARY_SLIP",
        p_label: label,
        p_storage_path: storagePath,
        p_file_mime_type: signedCopyFile.type,
        p_is_generated: false
      });

      if (registerError) {
        await supabase.storage.from("hr-documents").remove([storagePath]);
        toast.error(registerError.message || "Could not save document record.");
        return;
      }

      toast.success("Signed copy uploaded.");
      setSignedCopyFile(null);
      setSignedCopyLabel("");
      loadSlips(employeeId);
    } finally {
      setUploadingSignedCopy(false);
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <IndianRupee size={20} className="text-emerald-600" />
          Salary
        </h1>
        <p className="text-xs text-slate-500 mt-1">Set Basic Pay (effective-dated) and generate salary slips.</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm max-w-sm">
        <label className="text-xs font-semibold text-slate-500">Employee</label>
        <select
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          className="mt-1 h-10 w-full rounded-xl bg-slate-50 border border-slate-200 px-3 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-300"
        >
          <option value="">{loading ? "Loading..." : "Select employee"}</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>

      {employeeId && (
        <>
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-slate-800">Basic Pay</p>
              <p className="text-sm font-bold text-emerald-600">
                Current: {currentBasicPay !== null ? `Rs. ${formatINR(currentBasicPay)}` : "Not set"}
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-500">New Basic Pay (Rs.)</label>
                <input
                  type="number"
                  min={0}
                  value={newBasicPay}
                  onChange={(e) => setNewBasicPay(e.target.value)}
                  placeholder="e.g. 30000"
                  className="mt-1 h-10 w-40 rounded-xl bg-slate-50 border border-slate-200 px-3 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-300"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500">Effective From</label>
                <DateInput value={newEffectiveFrom} onChange={setNewEffectiveFrom} />
              </div>
              <button
                onClick={handleSetBasicPay}
                disabled={savingPay}
                className="h-10 px-4 rounded-xl bg-emerald-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-emerald-700 transition"
              >
                {savingPay ? "Saving..." : "Set Basic Pay"}
              </button>
            </div>

            {history.length > 0 && (
              <div className="pt-2 border-t border-slate-100">
                <p className="text-xs font-bold text-slate-500 flex items-center gap-1.5 mb-2">
                  <History size={12} /> History
                </p>
                <div className="space-y-1.5">
                  {history.map((h) => (
                    <div key={h.id} className="flex items-center justify-between text-xs">
                      <span className="text-slate-600">
                        From {h.effective_from} — Rs. {formatINR(h.basic_pay)}
                      </span>
                      <span className="text-slate-400">by {h.set_by?.name || "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-4">
            <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <FileText size={15} /> Generate Salary Slip
            </p>

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-500">Month</label>
                <DateInput value={slipMonth} onChange={setSlipMonth} mode="month" />
              </div>
              <button
                onClick={handleGenerateSlip}
                disabled={generating || currentBasicPay === null}
                className="h-10 px-4 rounded-xl bg-blue-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-blue-700 transition"
              >
                {generating ? "Generating..." : "Generate Slip"}
              </button>
            </div>

            <div className="pt-2 border-t border-slate-100 flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-500">Upload Signed Copy</label>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => setSignedCopyFile(e.target.files?.[0] || null)}
                  className="mt-1 block text-xs text-slate-600 file:mr-3 file:h-9 file:px-3 file:rounded-lg file:border-0 file:bg-slate-100 file:text-xs file:font-semibold file:text-slate-700 hover:file:bg-slate-200"
                />
              </div>
              <input
                type="text"
                value={signedCopyLabel}
                onChange={(e) => setSignedCopyLabel(e.target.value)}
                placeholder={`Salary Slip - ${monthLabel(slipMonth)} (Signed)`}
                className="h-10 w-56 rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
              />
              <button
                onClick={handleUploadSignedCopy}
                disabled={uploadingSignedCopy}
                className="h-10 px-4 rounded-xl bg-slate-800 text-white text-xs font-bold disabled:opacity-40 hover:bg-slate-900 transition flex items-center gap-1.5"
              >
                <Upload size={13} />
                {uploadingSignedCopy ? "Uploading..." : "Upload"}
              </button>
            </div>

            {slips.length > 0 && (
              <div className="pt-2 border-t border-slate-100 space-y-1.5">
                {slips.map((s) => (
                  <div key={s.id} className="flex items-center justify-between text-xs">
                    <span className="text-slate-600">{s.label}</span>
                    <button onClick={() => handleDownloadSlip(s)} className="flex items-center gap-1 text-blue-600 font-bold hover:underline">
                      <Download size={12} /> Download
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </motion.div>
  );
}
