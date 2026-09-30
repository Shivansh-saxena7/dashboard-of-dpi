"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import DateInput from "@/components/DateInput";

interface PayrollDetails {
  employee_code: string | null;
  gender: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_ifsc_code: string | null;
  uan_number: string | null;
  pf_account_number: string | null;
  esi_number: string | null;
  pan_number: string | null;
  date_of_joining: string | null;
  work_location: string | null;
  employment_type: string | null;
  employee_grade: string | null;
  updated_at: string | null;
  updated_by: { name: string } | null;
}

const BLANK_PAYROLL_DETAILS: PayrollDetails = {
  employee_code: "",
  gender: "",
  bank_name: "",
  bank_account_number: "",
  bank_ifsc_code: "",
  uan_number: "",
  pf_account_number: "",
  esi_number: "",
  pan_number: "",
  date_of_joining: "",
  work_location: "",
  employment_type: "",
  employee_grade: "",
  updated_at: null,
  updated_by: null
};

const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Probation"];

// Payroll master data (bank/PAN/UAN/ESI/employee code/gender) -- a plain
// mutable "current profile" row, NOT effective-dated history like Basic
// Pay: a bank account number is corrected in place, it doesn't need a
// past-dated audit trail the way salary does. One upsert per save, keyed
// on employee_id (the table's primary key). Shared by HR and Payroll
// (equal write access). onSaved lets a page with its own separate cached
// copy (e.g. the Payroll page's "Current Setup" employee-code display,
// or Generate Slip, which bakes these fields into the PDF) refresh after
// a save here.
export default function PayrollDetailsForm({ employeeId, onSaved }: { employeeId: string; onSaved?: () => void }) {
  const [payrollForm, setPayrollForm] = useState<PayrollDetails>(BLANK_PAYROLL_DETAILS);
  const [savingPayrollDetails, setSavingPayrollDetails] = useState(false);

  async function loadPayrollDetails() {
    const { data } = await supabase
      .from("employee_payroll_details")
      .select(
        "employee_code, gender, bank_name, bank_account_number, bank_ifsc_code, uan_number, pf_account_number, esi_number, pan_number, date_of_joining, work_location, employment_type, employee_grade, updated_at, updated_by:employees!employee_payroll_details_updated_by_employee_id_fkey(name)"
      )
      .eq("employee_id", employeeId)
      .maybeSingle();
    setPayrollForm(data ? ({ ...BLANK_PAYROLL_DETAILS, ...data } as unknown as PayrollDetails) : BLANK_PAYROLL_DETAILS);
  }

  useEffect(() => {
    loadPayrollDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  async function handleSavePayrollDetails() {
    if (!payrollForm.employee_code || !payrollForm.employee_code.trim()) {
      toast.error("Employee Code is required.");
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

    setSavingPayrollDetails(true);
    const { error } = await supabase.from("employee_payroll_details").upsert(
      {
        employee_id: employeeId,
        employee_code: payrollForm.employee_code || null,
        gender: payrollForm.gender || null,
        bank_name: payrollForm.bank_name || null,
        bank_account_number: payrollForm.bank_account_number || null,
        bank_ifsc_code: payrollForm.bank_ifsc_code || null,
        uan_number: payrollForm.uan_number || null,
        pf_account_number: payrollForm.pf_account_number || null,
        esi_number: payrollForm.esi_number || null,
        pan_number: payrollForm.pan_number || null,
        date_of_joining: payrollForm.date_of_joining || null,
        work_location: payrollForm.work_location || null,
        employment_type: payrollForm.employment_type || null,
        employee_grade: payrollForm.employee_grade || null,
        updated_by_employee_id: me.id,
        updated_at: new Date().toISOString()
      },
      { onConflict: "employee_id" }
    );
    setSavingPayrollDetails(false);

    if (error) {
      toast.error(error.message || "Could not save payroll details.");
      return;
    }
    toast.success("Payroll details saved.");
    loadPayrollDetails();
    onSaved?.();
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
      <p className="text-sm font-bold text-slate-800">Payroll Details</p>
      <p className="text-xs text-slate-500 -mt-2">Shown on the payslip. Employee Code is required; everything else is optional (blank shows as "—").</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        <div>
          <label className="text-xs font-semibold text-slate-500">System ID (read-only)</label>
          <input
            type="text"
            value={employeeId}
            disabled
            className="mt-1 h-9 w-full rounded-lg bg-slate-100 border border-slate-200 px-2.5 text-xs font-semibold text-slate-400"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500">Employee Code *</label>
          <input
            type="text"
            value={payrollForm.employee_code || ""}
            onChange={(e) => setPayrollForm((prev) => ({ ...prev, employee_code: e.target.value }))}
            placeholder="e.g. DPI-014"
            className="mt-1 h-9 w-full rounded-lg bg-slate-50 border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-300"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500">Date of Joining</label>
          <DateInput
            value={payrollForm.date_of_joining || ""}
            onChange={(v) => setPayrollForm((prev) => ({ ...prev, date_of_joining: v }))}
            className="mt-1 h-9 w-full rounded-lg bg-slate-50 border border-slate-200 pl-2.5 pr-8 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-300 cursor-pointer"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500">Employment Type</label>
          <select
            value={payrollForm.employment_type || ""}
            onChange={(e) => setPayrollForm((prev) => ({ ...prev, employment_type: e.target.value }))}
            className="mt-1 h-9 w-full rounded-lg bg-slate-50 border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-300"
          >
            <option value="">—</option>
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        {(
          [
            ["gender", "Gender"],
            ["employee_grade", "Grade"],
            ["work_location", "Work Location"],
            ["bank_name", "Bank Name"],
            ["bank_account_number", "A/C #"],
            ["bank_ifsc_code", "Bank IFSC Code"],
            ["uan_number", "UAN #"],
            ["pf_account_number", "PF Account #"],
            ["esi_number", "ESI #"],
            ["pan_number", "PAN #"]
          ] as [keyof PayrollDetails, string][]
        ).map(([key, label]) => (
          <div key={key}>
            <label className="text-xs font-semibold text-slate-500">{label}</label>
            <input
              type="text"
              value={(payrollForm[key] as string) || ""}
              onChange={(e) => setPayrollForm((prev) => ({ ...prev, [key]: e.target.value }))}
              className="mt-1 h-9 w-full rounded-lg bg-slate-50 border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-300"
            />
          </div>
        ))}
      </div>
      <button
        onClick={handleSavePayrollDetails}
        disabled={savingPayrollDetails}
        className="h-9 px-4 rounded-xl bg-slate-800 text-white text-xs font-bold disabled:opacity-40 hover:bg-slate-900 transition"
      >
        {savingPayrollDetails ? "Saving..." : "Save Payroll Details"}
      </button>
      {payrollForm.updated_by && (
        <p className="text-xs text-slate-400">
          Last updated by {payrollForm.updated_by.name} on {new Date(payrollForm.updated_at!).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}
