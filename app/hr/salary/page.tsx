"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { IndianRupee, FileText, Download, History, Upload, Printer, AlertTriangle, Cake } from "lucide-react";
import { supabase } from "@/lib/supabase";
import DateInput from "@/components/DateInput";
import { buildSalarySlipBlob, buildBulkSalarySlipPdf, SalarySlipInput } from "@/lib/generateHrDocumentPdf";
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
  date_of_birth: string | null;
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
  date_of_birth: ""
};

interface CompanySettings {
  company_cin: string | null;
  company_gstin: string | null;
}

const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Probation"];

function monthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { year: "numeric", month: "long" });
}

function daysInMonthOf(yyyyMm: string): number {
  const [y, m] = yyyyMm.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

// Logo fetched once per generation call, as a data: URL -- same
// "caller resolves the image, generateHrDocumentPdf.ts just draws it"
// contract already used for the Offer/Appointment Letter letterhead.
// Not cached in React state: it's a small static public asset, the
// browser's own HTTP cache already makes repeat fetches cheap, and
// this keeps the call sites simple.
async function getLogoDataUrl(): Promise<string | undefined> {
  try {
    const res = await fetch("/dpilogo.png");
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
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
  const [paidDaysOverride, setPaidDaysOverride] = useState("");
  const [lopDaysOverride, setLopDaysOverride] = useState("");
  const [totalWorkingDaysOverride, setTotalWorkingDaysOverride] = useState("");
  const [payDate, setPayDate] = useState("");

  const [payrollForm, setPayrollForm] = useState<PayrollDetails>(BLANK_PAYROLL_DETAILS);
  const [savingPayrollDetails, setSavingPayrollDetails] = useState(false);

  // Company-wide (not per-employee) registration numbers -- single row
  // in hrms_settings, same shape as the existing attendance-cutoff
  // settings that table already holds. Loaded once on mount alongside
  // employees/compensation, not per-employee like payrollForm.
  const [companySettings, setCompanySettings] = useState<CompanySettings>({ company_cin: "", company_gstin: "" });
  const [savingCompanySettings, setSavingCompanySettings] = useState(false);

  const [signedCopyFile, setSignedCopyFile] = useState<File | null>(null);
  const [signedCopyLabel, setSignedCopyLabel] = useState("");
  const [uploadingSignedCopy, setUploadingSignedCopy] = useState(false);

  const [bulkMonth, setBulkMonth] = useState(todayStr.slice(0, 7));
  const [bulkEmployeeIds, setBulkEmployeeIds] = useState<Set<string>>(new Set());
  const [bulkGenerating, setBulkGenerating] = useState(false);

  // Latest Basic Pay per employee, company-wide -- separate from
  // `history`, which only ever holds the ONE currently-selected
  // employee's full history. This map is what makes "who's missing
  // Basic Pay" visible at all; without it there was no query anywhere
  // that looked across every employee at once.
  const [compensationMap, setCompensationMap] = useState<Record<string, number>>({});
  const [showOnlyMissing, setShowOnlyMissing] = useState(true);
  const [bulkPayAmounts, setBulkPayAmounts] = useState<Record<string, string>>({});
  const [bulkPayEffectiveFrom, setBulkPayEffectiveFrom] = useState(todayStr);
  const [bulkPaySaving, setBulkPaySaving] = useState(false);

  // Date of Birth, company-wide -- same "overview + bulk-fill" shape as
  // Basic Pay above. employee_payroll_details has a hard CHECK
  // constraint requiring employee_code on every row (see
  // handleSavePayrollDetails' own comment), so an employee with no
  // payroll_details row yet (Employee Code never set) genuinely can't
  // be bulk-upserted here -- payrollDetailsExistsSet is what tells the
  // UI which rows are safe to offer an input for vs. which need
  // Employee Code set first, via the individual Payroll Details form.
  const [dobMap, setDobMap] = useState<Record<string, string | null>>({});
  const [payrollDetailsExistsSet, setPayrollDetailsExistsSet] = useState<Set<string>>(new Set());
  const [showOnlyMissingDob, setShowOnlyMissingDob] = useState(true);
  const [bulkDobValues, setBulkDobValues] = useState<Record<string, string>>({});
  const [bulkDobSaving, setBulkDobSaving] = useState(false);

  useEffect(() => {
    loadEmployees();
    loadAllCompensation();
    loadCompanySettings();
    loadAllDob();
  }, []);

  useEffect(() => {
    if (employeeId) {
      loadHistory(employeeId);
      loadSlips(employeeId);
      loadPayrollDetails(employeeId);
    } else {
      setHistory([]);
      setSlips([]);
      setPayrollForm(BLANK_PAYROLL_DETAILS);
    }
  }, [employeeId]);

  async function loadEmployees() {
    const { data } = await supabase.from("employees").select("id, name, department, role").eq("is_active", true).order("name");
    setEmployees(data || []);
    setLoading(false);
  }

  async function loadAllCompensation() {
    const { data } = await supabase
      .from("employee_compensation")
      .select("employee_id, basic_pay, effective_from")
      .order("effective_from", { ascending: false });

    // Reduce to the latest row per employee -- rows already arrive
    // newest-first, so the first row seen for a given employee_id is
    // their current Basic Pay, later ones for the same id are ignored.
    const map: Record<string, number> = {};
    for (const row of data || []) {
      if (!(row.employee_id in map)) map[row.employee_id] = row.basic_pay;
    }
    setCompensationMap(map);
  }

  async function loadAllDob() {
    const { data } = await supabase.from("employee_payroll_details").select("employee_id, date_of_birth");
    const map: Record<string, string | null> = {};
    const existsSet = new Set<string>();
    for (const row of data || []) {
      existsSet.add(row.employee_id);
      map[row.employee_id] = row.date_of_birth;
    }
    setDobMap(map);
    setPayrollDetailsExistsSet(existsSet);
  }

  // Same partial-column upsert pattern as handleSavePayrollDetails --
  // only date_of_birth (+ audit columns) is sent, so other existing
  // fields on that row (gender, bank details, ...) are never touched.
  // Rows with no payroll_details row yet are filtered out before this
  // even runs (see the CHECK-constraint comment on the state block
  // above) -- the UI never offers an input for them in the first
  // place, this filter is just defense in depth.
  async function handleBulkSetDob() {
    const rows = Object.entries(bulkDobValues).filter(([empId, val]) => val && payrollDetailsExistsSet.has(empId));

    if (rows.length === 0) {
      toast.error("Enter at least one date of birth for an employee that already has an Employee Code set.");
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

    // Plain UPDATE, not upsert -- Postgres validates CHECK constraints
    // (employee_code required) against the candidate INSERT row BEFORE
    // conflict detection even runs, so a partial-column .upsert() here
    // fails that check even when the row already exists and would only
    // ever take the update branch (confirmed live, 2026-09-28: an
    // .upsert() sending only employee_id/date_of_birth genuinely threw
    // employee_payroll_details_employee_code_required). Safe here
    // specifically because payrollDetailsExistsSet already guarantees
    // every row in `rows` exists.
    setBulkDobSaving(true);
    const results = await Promise.all(
      rows.map(([empId, val]) =>
        supabase
          .from("employee_payroll_details")
          .update({ date_of_birth: val, updated_by_employee_id: me.id, updated_at: new Date().toISOString() })
          .eq("employee_id", empId)
      )
    );
    setBulkDobSaving(false);

    const error = results.find((r) => r.error)?.error;
    if (error) {
      toast.error(error.message || "Could not save dates of birth.");
      return;
    }

    toast.success(`Date of Birth set for ${rows.length} employee(s).`);
    setBulkDobValues({});
    loadAllDob();
    if (employeeId && rows.some(([empId]) => empId === employeeId)) loadPayrollDetails(employeeId);
  }

  async function loadHistory(empId: string) {
    const { data } = await supabase
      .from("employee_compensation")
      .select("id, basic_pay, effective_from, created_at, set_by:employees!employee_compensation_set_by_employee_id_fkey(name)")
      .eq("employee_id", empId)
      .order("effective_from", { ascending: false });
    setHistory((data || []) as unknown as CompensationRow[]);
  }

  async function loadPayrollDetails(empId: string) {
    const { data } = await supabase
      .from("employee_payroll_details")
      .select(
        "employee_code, gender, bank_name, bank_account_number, bank_ifsc_code, uan_number, pf_account_number, esi_number, pan_number, date_of_joining, work_location, employment_type, employee_grade, date_of_birth"
      )
      .eq("employee_id", empId)
      .maybeSingle();

    let form = data ? { ...BLANK_PAYROLL_DETAILS, ...data } : BLANK_PAYROLL_DETAILS;

    // Pre-fill (never overwrite) from the candidate record this
    // employee was converted from, if their own Date of Birth is
    // still blank -- captured once at application intake
    // (app/hr/candidates/page.tsx), so HR is never asked twice. Still
    // just a suggestion sitting in the form until Save is clicked.
    if (!form.date_of_birth) {
      const { data: candidate } = await supabase
        .from("candidates")
        .select("date_of_birth")
        .eq("converted_employee_id", empId)
        .maybeSingle();
      if (candidate?.date_of_birth) {
        form = { ...form, date_of_birth: candidate.date_of_birth };
      }
    }

    setPayrollForm(form);
  }

  async function loadCompanySettings() {
    const { data } = await supabase.from("hrms_settings").select("company_cin, company_gstin").eq("id", 1).maybeSingle();
    if (data) setCompanySettings(data);
  }

  async function handleSaveCompanySettings() {
    setSavingCompanySettings(true);
    const { error } = await supabase
      .from("hrms_settings")
      .update({ company_cin: companySettings.company_cin || null, company_gstin: companySettings.company_gstin || null })
      .eq("id", 1);
    setSavingCompanySettings(false);

    if (error) {
      toast.error(error.message || "Could not save company details.");
      return;
    }
    toast.success("Company registration details saved.");
  }

  // Payroll master data (bank/PAN/UAN/ESI/employee code/gender) -- a
  // plain mutable "current profile" row, NOT effective-dated history
  // like Basic Pay: a bank account number is corrected in place, it
  // doesn't need a past-dated audit trail the way salary does. One
  // upsert per save, keyed on employee_id (the table's primary key).
  async function handleSavePayrollDetails() {
    if (!employeeId) return;
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
        date_of_birth: payrollForm.date_of_birth || null,
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
    loadAllCompensation();
  }

  // Bulk Set Basic Pay -- same insert-only/effective-dated model as
  // handleSetBasicPay above, just N rows in one request instead of one
  // at a time. No RPC: this insert has no cross-cutting side effect
  // (no notification fan-out, nothing else to keep atomic with it), so
  // a plain multi-row client insert is the right shape here, same
  // precedent hr_document_templates already established for tables
  // with no wrapper RPC. Only rows where HR actually typed an amount
  // are included -- a blank row is skipped, never treated as "set to 0".
  async function handleBulkSetBasicPay() {
    const rows = Object.entries(bulkPayAmounts)
      .map(([empId, amountStr]) => ({ empId, amount: Number(amountStr) }))
      .filter((r) => r.amount > 0);

    if (rows.length === 0) {
      toast.error("Enter at least one amount.");
      return;
    }
    if (!bulkPayEffectiveFrom) {
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

    setBulkPaySaving(true);
    const { error } = await supabase.from("employee_compensation").insert(
      rows.map((r) => ({
        employee_id: r.empId,
        basic_pay: r.amount,
        effective_from: bulkPayEffectiveFrom,
        set_by_employee_id: me.id
      }))
    );
    setBulkPaySaving(false);

    if (error) {
      toast.error(error.message || "Could not save Basic Pay.");
      return;
    }

    toast.success(`Basic Pay set for ${rows.length} employee(s).`);
    setBulkPayAmounts({});
    loadAllCompensation();
    if (employeeId && rows.some((r) => r.empId === employeeId)) loadHistory(employeeId);
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
    if (!payrollForm.employee_code || !payrollForm.employee_code.trim()) {
      toast.error("Set and save an Employee Code (Payroll Details above) before generating a slip.");
      return;
    }

    setGenerating(true);
    try {
      const periodLabel = monthLabel(slipMonth);
      const daysInMonth = daysInMonthOf(slipMonth);
      const logoDataUrl = await getLogoDataUrl();
      const blob = await buildSalarySlipBlob({
        employeeName: employee.name,
        department: employee.department,
        role: employee.role,
        periodLabel,
        basicPay: asOfRow.basic_pay,
        systemId: employeeId,
        employeeCode: payrollForm.employee_code,
        gender: payrollForm.gender,
        bankName: payrollForm.bank_name,
        bankAccountNumber: payrollForm.bank_account_number,
        bankIfscCode: payrollForm.bank_ifsc_code,
        uanNumber: payrollForm.uan_number,
        pfAccountNumber: payrollForm.pf_account_number,
        esiNumber: payrollForm.esi_number,
        panNumber: payrollForm.pan_number,
        dateOfJoining: payrollForm.date_of_joining,
        workLocation: payrollForm.work_location,
        employmentType: payrollForm.employment_type,
        employeeGrade: payrollForm.employee_grade,
        paidDays: paidDaysOverride !== "" ? Number(paidDaysOverride) : daysInMonth,
        lopDays: lopDaysOverride !== "" ? Number(lopDaysOverride) : 0,
        totalWorkingDays: totalWorkingDaysOverride !== "" ? Number(totalWorkingDaysOverride) : daysInMonth,
        daysInMonth,
        payDate: payDate || null,
        companyCin: companySettings.company_cin,
        companyGstin: companySettings.company_gstin,
        logoDataUrl
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

  function toggleBulkEmployee(id: string) {
    setBulkEmployeeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllBulk() {
    setBulkEmployeeIds((prev) => (prev.size === employees.length ? new Set() : new Set(employees.map((e) => e.id))));
  }

  // Bulk Print -- a separate, print-only convenience (see
  // generateHrDocumentPdf.ts's own comment on buildBulkSalarySlipPdf):
  // it never touches hr_documents, never calls register_hr_document_atomic,
  // and doesn't change the individual Generate Slip flow above at all.
  // It just lays each selected employee's slip (resolved the same
  // as-of-that-month way handleGenerateSlip does) onto shared A4 sheets
  // and triggers a direct download.
  async function handleBulkGenerate() {
    if (bulkEmployeeIds.size === 0) {
      toast.error("Select at least one employee.");
      return;
    }

    setBulkGenerating(true);
    try {
      const ids = Array.from(bulkEmployeeIds);
      const [{ data: compRows, error }, { data: payrollRows }, logoDataUrl] = await Promise.all([
        supabase.from("employee_compensation").select("employee_id, basic_pay, effective_from").in("employee_id", ids),
        supabase
          .from("employee_payroll_details")
          .select(
            "employee_id, employee_code, gender, bank_name, bank_account_number, bank_ifsc_code, uan_number, pf_account_number, esi_number, pan_number, date_of_joining, work_location, employment_type, employee_grade"
          )
          .in("employee_id", ids),
        getLogoDataUrl()
      ]);

      if (error) {
        toast.error(error.message || "Could not load compensation data.");
        return;
      }

      const payrollMap = new Map((payrollRows || []).map((r) => [r.employee_id, r]));
      const [y, m] = bulkMonth.split("-").map(Number);
      const periodEndDate = new Date(y, m, 0).toISOString().slice(0, 10);
      const periodLabel = monthLabel(bulkMonth);
      const daysInMonth = daysInMonthOf(bulkMonth);

      const slipsInput: SalarySlipInput[] = [];
      const skipped: string[] = [];

      for (const emp of employees.filter((e) => bulkEmployeeIds.has(e.id))) {
        const asOfRow = (compRows || [])
          .filter((r) => r.employee_id === emp.id && r.effective_from <= periodEndDate)
          .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0];

        if (!asOfRow) {
          skipped.push(`${emp.name} (no Basic Pay)`);
          continue;
        }

        const payroll = payrollMap.get(emp.id);
        if (!payroll?.employee_code || !payroll.employee_code.trim()) {
          skipped.push(`${emp.name} (no Employee Code)`);
          continue;
        }

        slipsInput.push({
          employeeName: emp.name,
          department: emp.department,
          role: emp.role,
          periodLabel,
          basicPay: asOfRow.basic_pay,
          systemId: emp.id,
          employeeCode: payroll.employee_code,
          gender: payroll?.gender,
          bankName: payroll?.bank_name,
          bankAccountNumber: payroll?.bank_account_number,
          bankIfscCode: payroll?.bank_ifsc_code,
          uanNumber: payroll?.uan_number,
          pfAccountNumber: payroll?.pf_account_number,
          esiNumber: payroll?.esi_number,
          panNumber: payroll?.pan_number,
          dateOfJoining: payroll?.date_of_joining,
          workLocation: payroll?.work_location,
          employmentType: payroll?.employment_type,
          employeeGrade: payroll?.employee_grade,
          paidDays: daysInMonth,
          lopDays: 0,
          totalWorkingDays: daysInMonth,
          daysInMonth,
          payDate: null,
          companyCin: companySettings.company_cin,
          companyGstin: companySettings.company_gstin,
          logoDataUrl
        });
      }

      if (slipsInput.length === 0) {
        toast.error("None of the selected employees are ready (need Basic Pay and a saved Employee Code).");
        return;
      }

      const blob = await buildBulkSalarySlipPdf(slipsInput);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Salary-Slips-Bulk-${bulkMonth}.pdf`;
      a.click();
      URL.revokeObjectURL(url);

      if (skipped.length > 0) {
        toast.error(`Skipped: ${skipped.join(", ")}`);
      }
      toast.success(`Bulk PDF generated — ${slipsInput.length} slip(s).`);
    } finally {
      setBulkGenerating(false);
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

      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
        <p className="text-sm font-bold text-slate-800">Company Registration Details</p>
        <p className="text-xs text-slate-500 -mt-2">Shown in the slip header, blank until set. Company-wide, not per-employee.</p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-500">CIN</label>
            <input
              type="text"
              value={companySettings.company_cin || ""}
              onChange={(e) => setCompanySettings((prev) => ({ ...prev, company_cin: e.target.value }))}
              className="mt-1 h-9 w-48 rounded-lg bg-slate-50 border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-300"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">GSTIN</label>
            <input
              type="text"
              value={companySettings.company_gstin || ""}
              onChange={(e) => setCompanySettings((prev) => ({ ...prev, company_gstin: e.target.value }))}
              className="mt-1 h-9 w-48 rounded-lg bg-slate-50 border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-300"
            />
          </div>
          <button
            onClick={handleSaveCompanySettings}
            disabled={savingCompanySettings}
            className="h-9 px-4 rounded-xl bg-slate-800 text-white text-xs font-bold disabled:opacity-40 hover:bg-slate-900 transition"
          >
            {savingCompanySettings ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
            <AlertTriangle size={15} className="text-amber-500" /> Basic Pay Overview
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={() => setShowOnlyMissing(true)}
              className={`h-8 px-3 rounded-lg text-xs font-bold transition ${showOnlyMissing ? "bg-amber-100 text-amber-700" : "bg-slate-50 text-slate-500"}`}
            >
              Missing Basic Pay ({employees.filter((e) => !(e.id in compensationMap)).length})
            </button>
            <button
              onClick={() => setShowOnlyMissing(false)}
              className={`h-8 px-3 rounded-lg text-xs font-bold transition ${!showOnlyMissing ? "bg-slate-800 text-white" : "bg-slate-50 text-slate-500"}`}
            >
              All Employees
            </button>
          </div>
        </div>

        {(() => {
          const rows = employees.filter((e) => !showOnlyMissing || !(e.id in compensationMap));
          if (rows.length === 0) {
            return <p className="text-xs text-slate-400">Everyone has Basic Pay set.</p>;
          }
          return (
            <>
              <div className="flex flex-wrap items-end gap-3 pb-2 border-b border-slate-100">
                <div>
                  <label className="text-xs font-semibold text-slate-500">Effective From (applies to all rows filled below)</label>
                  <DateInput value={bulkPayEffectiveFrom} onChange={setBulkPayEffectiveFrom} />
                </div>
                <button
                  onClick={handleBulkSetBasicPay}
                  disabled={bulkPaySaving}
                  className="h-10 px-4 rounded-xl bg-emerald-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-emerald-700 transition"
                >
                  {bulkPaySaving ? "Saving..." : "Save All"}
                </button>
              </div>

              <div className="max-h-72 overflow-y-auto space-y-1.5">
                {rows.map((e) => (
                  <div key={e.id} className="flex items-center gap-3 text-xs">
                    <span className="flex-1 text-slate-700 font-semibold">{e.name}</span>
                    <span
                      className={`w-24 shrink-0 text-right font-bold ${e.id in compensationMap ? "text-emerald-600" : "text-amber-600"}`}
                    >
                      {e.id in compensationMap ? `Rs. ${formatINR(compensationMap[e.id])}` : "Missing"}
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={bulkPayAmounts[e.id] || ""}
                      onChange={(ev) => setBulkPayAmounts((prev) => ({ ...prev, [e.id]: ev.target.value }))}
                      placeholder="New amount"
                      className="w-28 h-8 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-300"
                    />
                  </div>
                ))}
              </div>
            </>
          );
        })()}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
            <Cake size={15} className="text-pink-500" /> Date of Birth Overview
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={() => setShowOnlyMissingDob(true)}
              className={`h-8 px-3 rounded-lg text-xs font-bold transition ${showOnlyMissingDob ? "bg-pink-100 text-pink-700" : "bg-slate-50 text-slate-500"}`}
            >
              Missing DOB ({employees.filter((e) => !dobMap[e.id]).length})
            </button>
            <button
              onClick={() => setShowOnlyMissingDob(false)}
              className={`h-8 px-3 rounded-lg text-xs font-bold transition ${!showOnlyMissingDob ? "bg-slate-800 text-white" : "bg-slate-50 text-slate-500"}`}
            >
              All Employees
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-500 -mt-2">
          Powers the automatic birthday celebration. Employees without an Employee Code set yet can't be bulk-saved here — set that
          first in their individual Payroll Details below.
        </p>

        {(() => {
          const rows = employees.filter((e) => !showOnlyMissingDob || !dobMap[e.id]);
          if (rows.length === 0) {
            return <p className="text-xs text-slate-400">Everyone has a Date of Birth set.</p>;
          }
          return (
            <>
              <div className="flex justify-end">
                <button
                  onClick={handleBulkSetDob}
                  disabled={bulkDobSaving}
                  className="h-10 px-4 rounded-xl bg-pink-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-pink-700 transition"
                >
                  {bulkDobSaving ? "Saving..." : "Save All"}
                </button>
              </div>

              <div className="max-h-72 overflow-y-auto space-y-1.5">
                {rows.map((e) => (
                  <div key={e.id} className="flex items-center gap-3 text-xs">
                    <span className="flex-1 text-slate-700 font-semibold">{e.name}</span>
                    <span className={`w-24 shrink-0 text-right font-bold ${dobMap[e.id] ? "text-emerald-600" : "text-pink-600"}`}>
                      {dobMap[e.id] ? new Date(dobMap[e.id]!).toLocaleDateString("en-IN") : "Missing"}
                    </span>
                    {payrollDetailsExistsSet.has(e.id) ? (
                      <DateInput
                        value={bulkDobValues[e.id] || ""}
                        onChange={(v) => setBulkDobValues((prev) => ({ ...prev, [e.id]: v }))}
                        className="w-40 h-8 rounded-lg bg-slate-50 border border-slate-200 pl-2 pr-7 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-pink-100 focus:border-pink-300"
                      />
                    ) : (
                      <span className="w-40 h-8 flex items-center justify-center text-slate-400 italic text-[11px]">Set Employee Code first</span>
                    )}
                  </div>
                ))}
              </div>
            </>
          );
        })()}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
        <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
          <Printer size={15} /> Bulk Print (2 slips per A4 sheet)
        </p>
        <p className="text-xs text-slate-500">
          Print-only — doesn't affect each employee's individually generated/archived slip above.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-500">Month</label>
            <DateInput value={bulkMonth} onChange={setBulkMonth} mode="month" />
          </div>
          <button
            onClick={handleBulkGenerate}
            disabled={bulkGenerating}
            className="h-10 px-4 rounded-xl bg-indigo-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-indigo-700 transition"
          >
            {bulkGenerating ? "Generating..." : "Generate Bulk PDF"}
          </button>
        </div>

        <div>
          <button onClick={toggleSelectAllBulk} className="text-xs font-bold text-indigo-600 hover:underline">
            {bulkEmployeeIds.size === employees.length ? "Deselect all" : "Select all"}
          </button>
          <div className="mt-2 max-h-48 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-1.5 border border-slate-100 rounded-xl p-2">
            {employees.map((e) => (
              <label key={e.id} className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={bulkEmployeeIds.has(e.id)}
                  onChange={() => toggleBulkEmployee(e.id)}
                  // globals.css sets `appearance: none` on every <input>
                  // (an iOS-Safari fix for text/date/number inputs, which
                  // all carry their own explicit Tailwind sizing) -- a
                  // bare checkbox has no such sizing, so it collapsed to
                  // 0x0 and was genuinely un-clickable, not just invisible.
                  // `appearance: auto` restores native checkbox rendering
                  // for this input specifically so accent-color + the
                  // explicit size actually show up.
                  style={{ appearance: "auto" }}
                  className="h-4 w-4 shrink-0 accent-indigo-600 cursor-pointer"
                />
                {e.name}
              </label>
            ))}
          </div>
        </div>
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
                <label className="text-xs font-semibold text-slate-500">Date of Birth</label>
                <DateInput
                  value={payrollForm.date_of_birth || ""}
                  onChange={(v) => setPayrollForm((prev) => ({ ...prev, date_of_birth: v }))}
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
                    value={payrollForm[key] || ""}
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
              <div>
                <label className="text-xs font-semibold text-slate-500">Paid Days</label>
                <input
                  type="number"
                  min={0}
                  value={paidDaysOverride}
                  onChange={(e) => setPaidDaysOverride(e.target.value)}
                  placeholder={String(daysInMonthOf(slipMonth))}
                  className="h-10 w-24 rounded-xl bg-slate-50 border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500">LOP Days</label>
                <input
                  type="number"
                  min={0}
                  value={lopDaysOverride}
                  onChange={(e) => setLopDaysOverride(e.target.value)}
                  placeholder="0"
                  className="h-10 w-24 rounded-xl bg-slate-50 border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500">Working Days</label>
                <input
                  type="number"
                  min={0}
                  value={totalWorkingDaysOverride}
                  onChange={(e) => setTotalWorkingDaysOverride(e.target.value)}
                  placeholder={String(daysInMonthOf(slipMonth))}
                  className="h-10 w-24 rounded-xl bg-slate-50 border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500">Pay Date</label>
                <DateInput value={payDate} onChange={setPayDate} />
              </div>
              <button
                onClick={handleGenerateSlip}
                disabled={generating || currentBasicPay === null || !payrollForm.employee_code?.trim()}
                className="h-10 px-4 rounded-xl bg-blue-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-blue-700 transition"
              >
                {generating ? "Generating..." : "Generate Slip"}
              </button>
            </div>
            {!payrollForm.employee_code?.trim() && (
              <p className="text-xs text-amber-600">Save an Employee Code in Payroll Details above to enable generation.</p>
            )}

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
