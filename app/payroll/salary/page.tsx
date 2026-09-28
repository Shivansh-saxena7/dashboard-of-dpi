"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { IndianRupee, FileText, Download, Upload, Printer, Percent, ShieldCheck, AlarmClock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import DateInput from "@/components/DateInput";
import { buildSalarySlipBlob, buildBulkSalarySlipPdf, SalarySlipInput } from "@/lib/generateHrDocumentPdf";
import { formatINR } from "@/lib/exportTable";
import {
  computeCommissionForMonth,
  computeConditionRuleForMonth,
  computeAttendanceDeductionForMonth,
  CommissionComputeResult,
  ConditionRuleComputeResult,
  AttendanceDeductionComputeResult
} from "@/lib/computePayrollAdjustments";

interface EmployeeRow {
  id: string;
  name: string;
  department: string | null;
  role: string;
}

interface CompensationRow {
  basic_pay: number;
  effective_from: string;
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
  employee_grade: ""
};

interface CompanySettings {
  company_cin: string | null;
  company_gstin: string | null;
}

interface CommissionAssignmentRow {
  effective_from: string;
  plan: { name: string } | null;
}

interface PayrollRuleAssignmentRow {
  effective_from: string;
  rule: { name: string } | null;
}

type AttendanceRuleType = "LATE_COMING_THRESHOLD" | "SANDWICH_LEAVE";

interface AttendanceRuleAssignmentRow {
  rule_id: string | null;
  effective_from: string;
  rule: { name: string; rule_type: AttendanceRuleType } | null;
}

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

// Payroll's side of the Salary split -- read-only visibility into
// everything HR sets (Basic Pay, Commission Plan, Condition Rule,
// Attendance Deduction Rules: see app/hr/salary/page.tsx, the only
// place any of that is editable), plus the actual slip-issuing
// machinery: Compute, Generate Slip, Bulk Print, Upload Signed Copy.
// RLS backs this split for real -- every table here is either a
// *_payroll_select-only policy (definitions/assignments) or payroll-
// write or hr+payroll-select (the three computed-result tables Compute
// writes to). This page never inserts/updates any HR-owned table.
export default function PayrollSalaryPage() {
  const todayStr = new Date().toISOString().slice(0, 10);

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [loading, setLoading] = useState(true);

  const [history, setHistory] = useState<CompensationRow[]>([]);
  const [payrollForm, setPayrollForm] = useState<PayrollDetails>(BLANK_PAYROLL_DETAILS);
  const [companySettings, setCompanySettings] = useState<CompanySettings>({ company_cin: "", company_gstin: "" });

  const [currentCommissionAssignment, setCurrentCommissionAssignment] = useState<CommissionAssignmentRow | null>(null);
  const [currentRuleAssignment, setCurrentRuleAssignment] = useState<PayrollRuleAssignmentRow | null>(null);
  const [currentLateRule, setCurrentLateRule] = useState<AttendanceRuleAssignmentRow | null>(null);
  const [currentSandwichRule, setCurrentSandwichRule] = useState<AttendanceRuleAssignmentRow | null>(null);

  const [slipMonth, setSlipMonth] = useState(todayStr.slice(0, 7));
  const [generating, setGenerating] = useState(false);
  const [slips, setSlips] = useState<SlipRow[]>([]);
  const [paidDaysOverride, setPaidDaysOverride] = useState("");
  const [lopDaysOverride, setLopDaysOverride] = useState("");
  const [totalWorkingDaysOverride, setTotalWorkingDaysOverride] = useState("");
  const [payDate, setPayDate] = useState("");

  const [signedCopyFile, setSignedCopyFile] = useState<File | null>(null);
  const [signedCopyLabel, setSignedCopyLabel] = useState("");
  const [uploadingSignedCopy, setUploadingSignedCopy] = useState(false);

  const [bulkMonth, setBulkMonth] = useState(todayStr.slice(0, 7));
  const [bulkEmployeeIds, setBulkEmployeeIds] = useState<Set<string>>(new Set());
  const [bulkGenerating, setBulkGenerating] = useState(false);

  const [computingAdjustments, setComputingAdjustments] = useState(false);
  const [commissionResult, setCommissionResult] = useState<CommissionComputeResult | null>(null);
  const [conditionRuleResult, setConditionRuleResult] = useState<ConditionRuleComputeResult | null>(null);
  const [attendanceDeductionResult, setAttendanceDeductionResult] = useState<AttendanceDeductionComputeResult | null>(null);
  // Which month + employee the results above were actually computed
  // for -- Generate Slip only ever uses them when both still match its
  // own employeeId/slipMonth at click time, so switching the month (or
  // employee) after computing can never silently attach one month's
  // numbers to a different slip.
  const [computedForKey, setComputedForKey] = useState<string | null>(null);

  useEffect(() => {
    loadEmployees();
    loadCompanySettings();
  }, []);

  useEffect(() => {
    if (employeeId) {
      loadHistory(employeeId);
      loadPayrollDetails(employeeId);
      loadSlips(employeeId);
      loadCurrentCommission(employeeId);
      loadCurrentConditionRule(employeeId);
      loadCurrentAttendanceRules(employeeId);
    } else {
      setHistory([]);
      setPayrollForm(BLANK_PAYROLL_DETAILS);
      setSlips([]);
      setCurrentCommissionAssignment(null);
      setCurrentRuleAssignment(null);
      setCurrentLateRule(null);
      setCurrentSandwichRule(null);
    }
    setCommissionResult(null);
    setConditionRuleResult(null);
    setAttendanceDeductionResult(null);
    setComputedForKey(null);
  }, [employeeId]);

  async function loadEmployees() {
    const { data } = await supabase.from("employees").select("id, name, department, role").eq("is_active", true).order("name");
    setEmployees(data || []);
    setLoading(false);
  }

  async function loadCompanySettings() {
    const { data } = await supabase.from("hrms_settings").select("company_cin, company_gstin").eq("id", 1).maybeSingle();
    if (data) setCompanySettings(data);
  }

  async function loadHistory(empId: string) {
    const { data } = await supabase
      .from("employee_compensation")
      .select("basic_pay, effective_from")
      .eq("employee_id", empId)
      .order("effective_from", { ascending: false });
    setHistory(data || []);
  }

  async function loadPayrollDetails(empId: string) {
    const { data } = await supabase
      .from("employee_payroll_details")
      .select(
        "employee_code, gender, bank_name, bank_account_number, bank_ifsc_code, uan_number, pf_account_number, esi_number, pan_number, date_of_joining, work_location, employment_type, employee_grade"
      )
      .eq("employee_id", empId)
      .maybeSingle();
    setPayrollForm(data ? { ...BLANK_PAYROLL_DETAILS, ...data } : BLANK_PAYROLL_DETAILS);
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

  async function loadCurrentCommission(empId: string) {
    const { data } = await supabase
      .from("employee_commission_plan_assignments")
      .select("effective_from, plan:commission_plans(name)")
      .eq("employee_id", empId)
      .lte("effective_from", todayStr)
      .order("effective_from", { ascending: false })
      .limit(1);
    setCurrentCommissionAssignment((data?.[0] as unknown as CommissionAssignmentRow) || null);
  }

  async function loadCurrentConditionRule(empId: string) {
    const { data } = await supabase
      .from("employee_payroll_rule_assignments")
      .select("effective_from, rule:payroll_condition_rules(name)")
      .eq("employee_id", empId)
      .lte("effective_from", todayStr)
      .order("effective_from", { ascending: false })
      .limit(1);
    setCurrentRuleAssignment((data?.[0] as unknown as PayrollRuleAssignmentRow) || null);
  }

  // Same conservative per-type resolution as app/hr/salary/page.tsx's
  // currentAttRuleForType() -- latest row among {unassign rows} union
  // {rows of this type}, so an unassign always wins ties.
  async function loadCurrentAttendanceRules(empId: string) {
    const { data } = await supabase
      .from("employee_attendance_deduction_rule_assignments")
      .select("rule_id, effective_from, rule:attendance_deduction_rules(name, rule_type)")
      .eq("employee_id", empId)
      .lte("effective_from", todayStr)
      .order("effective_from", { ascending: false });
    const rows = (data || []) as unknown as AttendanceRuleAssignmentRow[];
    const forType = (type: AttendanceRuleType) => rows.filter((a) => a.rule_id === null || a.rule?.rule_type === type)[0] || null;
    setCurrentLateRule(forType("LATE_COMING_THRESHOLD"));
    setCurrentSandwichRule(forType("SANDWICH_LEAVE"));
  }

  const currentBasicPay = history.find((h) => h.effective_from <= todayStr)?.basic_pay ?? null;

  async function handleComputeAdjustments() {
    if (!employeeId) return;

    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: me } = await supabase.from("employees").select("id").eq("auth_user_id", user.id).single();
    if (!me) {
      toast.error("Could not identify your employee record.");
      return;
    }

    setComputingAdjustments(true);
    try {
      const [commission, conditionRule, attendanceDeduction] = await Promise.all([
        computeCommissionForMonth(employeeId, slipMonth, me.id),
        computeConditionRuleForMonth(employeeId, slipMonth, me.id),
        computeAttendanceDeductionForMonth(employeeId, slipMonth, me.id)
      ]);
      setCommissionResult(commission);
      setConditionRuleResult(conditionRule);
      setAttendanceDeductionResult(attendanceDeduction);
      setComputedForKey(`${employeeId}:${slipMonth}`);
      if (!attendanceDeduction.skipped) {
        setLopDaysOverride(String(attendanceDeduction.totalLopDays));
      }
      toast.success(`Adjustments computed for ${monthLabel(slipMonth)}.`);
    } catch (err) {
      console.error(err);
      toast.error("Could not compute adjustments.");
    } finally {
      setComputingAdjustments(false);
    }
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
      toast.error("This employee has no Employee Code saved yet — ask HR to set it in Payroll Details.");
      return;
    }

    setGenerating(true);
    try {
      const periodLabel = monthLabel(slipMonth);
      const daysInMonth = daysInMonthOf(slipMonth);
      const logoDataUrl = await getLogoDataUrl();

      // Only attach computed adjustments if they were computed for
      // THIS exact employee+month -- see computedForKey's own comment.
      const adjustmentsMatchCurrent = computedForKey === `${employeeId}:${slipMonth}`;
      const commissionAmount = adjustmentsMatchCurrent ? commissionResult?.commissionAmount || 0 : 0;
      const performanceCutAmount = adjustmentsMatchCurrent ? conditionRuleResult?.baseCutAmount || 0 : 0;
      const performanceRefundAmount = adjustmentsMatchCurrent ? conditionRuleResult?.refundAppliedAmount || 0 : 0;

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
        logoDataUrl,
        commissionAmount,
        performanceCutAmount,
        performanceRefundAmount
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
  // signed scan comes back in here as the real record.
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

  // Bulk Print -- a separate, print-only convenience: it never touches
  // hr_documents, never calls register_hr_document_atomic, and doesn't
  // change the individual Generate Slip flow above at all. It just lays
  // each selected employee's slip (resolved the same as-of-that-month
  // way handleGenerateSlip does) onto shared A4 sheets and triggers a
  // direct download. Uses flat defaults (no per-employee Compute), same
  // as before the role split.
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
        <p className="text-xs text-slate-500 mt-1">
          Compute adjustments and issue salary slips. Basic Pay, Commission Plans, Condition Rules, and Attendance Deduction Rules are
          set by HR — shown here read-only.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
        <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
          <Printer size={15} /> Bulk Print (2 slips per A4 sheet)
        </p>
        <p className="text-xs text-slate-500">
          Print-only — doesn't affect each employee's individually generated/archived slip below.
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
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
            <p className="text-sm font-bold text-slate-800">Current Setup (set by HR)</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="text-xs">
                <p className="font-bold text-slate-500 flex items-center gap-1"><IndianRupee size={11} /> Basic Pay</p>
                <p className="text-slate-800 font-semibold">{currentBasicPay !== null ? `Rs. ${formatINR(currentBasicPay)}` : "Not set"}</p>
              </div>
              <div className="text-xs">
                <p className="font-bold text-slate-500 flex items-center gap-1"><Percent size={11} /> Commission Plan</p>
                <p className="text-slate-800 font-semibold">{currentCommissionAssignment?.plan?.name || "None"}</p>
              </div>
              <div className="text-xs">
                <p className="font-bold text-slate-500 flex items-center gap-1"><ShieldCheck size={11} /> Condition Rule</p>
                <p className="text-slate-800 font-semibold">{currentRuleAssignment?.rule?.name || "None"}</p>
              </div>
              <div className="text-xs">
                <p className="font-bold text-slate-500 flex items-center gap-1"><AlarmClock size={11} /> Late Coming Rule</p>
                <p className="text-slate-800 font-semibold">{currentLateRule?.rule?.name || "None"}</p>
              </div>
              <div className="text-xs">
                <p className="font-bold text-slate-500 flex items-center gap-1"><AlarmClock size={11} /> Sandwich Leave Rule</p>
                <p className="text-slate-800 font-semibold">{currentSandwichRule?.rule?.name || "None"}</p>
              </div>
              <div className="text-xs">
                <p className="font-bold text-slate-500">Employee Code</p>
                <p className="text-slate-800 font-semibold">{payrollForm.employee_code || "Not set"}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-sm font-bold text-slate-800">Compute Payroll Adjustments</p>
              <button
                onClick={handleComputeAdjustments}
                disabled={computingAdjustments}
                className="h-9 px-4 rounded-xl bg-indigo-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-indigo-700 transition"
              >
                {computingAdjustments ? "Computing..." : `Compute for ${monthLabel(slipMonth)}`}
              </button>
            </div>
            <p className="text-xs text-slate-500 -mt-2">
              Commission, condition-rule cut/refund, and attendance-deduction LOP days for the Salary Slip's month below. Safe to
              re-run — recomputing replaces the previous result, not a duplicate.
            </p>

            {(commissionResult || conditionRuleResult || attendanceDeductionResult) && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100">
                <div className="text-xs">
                  <p className="font-bold text-slate-600">Commission</p>
                  {commissionResult?.skipped ? (
                    <p className="text-slate-400">{commissionResult.skipped}</p>
                  ) : (
                    <p className="text-slate-700">
                      Rs. {formatINR(commissionResult?.commissionAmount || 0)} ({commissionResult?.bookingsCount || 0} booking(s))
                    </p>
                  )}
                </div>
                <div className="text-xs">
                  <p className="font-bold text-slate-600">Condition Rule</p>
                  {conditionRuleResult?.skipped ? (
                    <p className="text-slate-400">{conditionRuleResult.skipped}</p>
                  ) : (
                    <>
                      <p className="text-slate-700">
                        {conditionRuleResult?.metricValue} booking(s) → {conditionRuleResult?.salaryPercentApplied}% pay
                      </p>
                      {(conditionRuleResult?.baseCutAmount || 0) > 0 && (
                        <p className="text-red-600 font-semibold">Cut: Rs. {formatINR(conditionRuleResult!.baseCutAmount)}</p>
                      )}
                      {(conditionRuleResult?.refundAppliedAmount || 0) > 0 && (
                        <p className="text-emerald-600 font-semibold">Refund: Rs. {formatINR(conditionRuleResult!.refundAppliedAmount)}</p>
                      )}
                    </>
                  )}
                </div>
                <div className="text-xs">
                  <p className="font-bold text-slate-600">Attendance Deduction</p>
                  {attendanceDeductionResult?.skipped ? (
                    <p className="text-slate-400">{attendanceDeductionResult.skipped}</p>
                  ) : (
                    <p className="text-slate-700">
                      {attendanceDeductionResult?.totalLopDays} LOP day(s) (Late: {attendanceDeductionResult?.lateComingLopDays}, Sandwich:{" "}
                      {attendanceDeductionResult?.sandwichLeaveLopDays})
                    </p>
                  )}
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
              <p className="text-xs text-amber-600">This employee has no Employee Code saved yet — ask HR to set it in Payroll Details.</p>
            )}
            {computedForKey === `${employeeId}:${slipMonth}` ? (
              <p className="text-xs text-emerald-600">Computed commission/condition-rule adjustments for {monthLabel(slipMonth)} will be included in this slip.</p>
            ) : (
              <p className="text-xs text-slate-400">
                No computed adjustments for {monthLabel(slipMonth)} yet — click Compute above first, or this slip will show Incentives/Performance
                rows as 0.
              </p>
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
