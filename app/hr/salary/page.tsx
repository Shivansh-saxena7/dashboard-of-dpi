"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { IndianRupee, History, AlertTriangle, Briefcase } from "lucide-react";
import { supabase } from "@/lib/supabase";
import DateInput from "@/components/DateInput";
import { formatINR } from "@/lib/exportTable";
import { fetchAllRows } from "@/lib/fetchAllRows";
import CompanyRegistrationDetails from "@/components/payroll/CompanyRegistrationDetails";
import CommissionPlansBuilder from "@/components/payroll/CommissionPlansBuilder";
import PayrollConditionRulesBuilder from "@/components/payroll/PayrollConditionRulesBuilder";
import AttendanceDeductionRulesBuilder from "@/components/payroll/AttendanceDeductionRulesBuilder";
import BasicPayOverview from "@/components/payroll/BasicPayOverview";

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

interface CommissionPlanTier {
  id: string;
  plan_id: string;
  min_bookings: number;
  rate_type: "PERCENT_OF_SALE_VALUE" | "FLAT_PER_BOOKING";
  rate_value: number;
  sort_order: number;
}

interface CommissionPlan {
  id: string;
  name: string;
  created_at: string;
  tiers: CommissionPlanTier[];
}

interface CommissionAssignmentRow {
  id: string;
  plan_id: string | null;
  effective_from: string;
  plan: { name: string } | null;
  assigned_by: { name: string } | null;
}

interface PayrollConditionRuleTier {
  id: string;
  rule_id: string;
  min_metric_value: number;
  salary_percent: number;
  sort_order: number;
}

interface PayrollConditionRule {
  id: string;
  name: string;
  metric: string;
  refund_on_recovery: boolean;
  created_at: string;
  tiers: PayrollConditionRuleTier[];
}

interface PayrollRuleAssignmentRow {
  id: string;
  rule_id: string | null;
  effective_from: string;
  rule: { name: string } | null;
  assigned_by: { name: string } | null;
}

type AttendanceRuleType = "LATE_COMING_THRESHOLD" | "SANDWICH_LEAVE";

interface AttendanceRule {
  id: string;
  name: string;
  rule_type: AttendanceRuleType;
  created_at: string;
}

interface AttendanceRuleAssignmentRow {
  id: string;
  rule_id: string | null;
  effective_from: string;
  rule: { name: string; rule_type: AttendanceRuleType } | null;
  assigned_by: { name: string } | null;
}

const ATTENDANCE_RULE_TYPE_LABELS: Record<AttendanceRuleType, string> = {
  LATE_COMING_THRESHOLD: "Late Coming",
  SANDWICH_LEAVE: "Sandwich Leave"
};

interface LeadOption {
  id: string;
  name: string;
  mobile: string;
}

interface BookingRow {
  id: string;
  sale_value: number;
  booked_at: string;
  lead: { name: string } | null;
}

interface MissingSaleValueLead {
  id: string;
  name: string;
  mobile: string;
  current_owner_id: string | null;
  board_stage_changed_at: string | null;
}

const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Probation"];

// Salary policy/setup. Payroll now has equal write access on every
// table this page touches (RLS was expanded to full HR/Payroll parity),
// so the company-wide sections (Company Registration Details, Commission
// Plans, Payroll Condition Rules, Attendance Deduction Rules, Basic Pay
// Overview) live in components/payroll/* and are mounted on both this
// page and app/payroll/salary/page.tsx -- one owner for each, not a
// second copy kept in sync by hand. Per-employee assignment sections
// (Basic Pay set, plan/rule assignment, Payroll Details, Log Booking)
// are still inline here only, pending the same extraction.
export default function HrSalaryPage() {
  const todayStr = new Date().toISOString().slice(0, 10);

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [loading, setLoading] = useState(true);

  const [history, setHistory] = useState<CompensationRow[]>([]);
  const [newBasicPay, setNewBasicPay] = useState("");
  const [newEffectiveFrom, setNewEffectiveFrom] = useState(todayStr);
  const [savingPay, setSavingPay] = useState(false);

  const [payrollForm, setPayrollForm] = useState<PayrollDetails>(BLANK_PAYROLL_DETAILS);
  const [savingPayrollDetails, setSavingPayrollDetails] = useState(false);

  // Commission Plans list -- the create form now lives in
  // components/payroll/CommissionPlansBuilder.tsx (mounted below,
  // passed loadCommissionPlans as onCreated); this state stays here
  // because the plan-assignment dropdown further down still needs it.
  // Assignment to an employee is its own separate effective-dated
  // history table, same "drawer" nullable-FK pattern as everywhere else
  // in this phase: a row with plan_id = null means unassigned from that
  // date.
  const [commissionPlans, setCommissionPlans] = useState<CommissionPlan[]>([]);

  const [commissionAssignments, setCommissionAssignments] = useState<CommissionAssignmentRow[]>([]);
  const [assignPlanId, setAssignPlanId] = useState("");
  const [assignPlanEffectiveFrom, setAssignPlanEffectiveFrom] = useState(todayStr);
  const [assigningPlan, setAssigningPlan] = useState(false);

  // Payroll Condition Rules list -- create form lives in
  // components/payroll/PayrollConditionRulesBuilder.tsx; this state
  // stays here for the rule-assignment dropdown below.
  const [conditionRules, setConditionRules] = useState<PayrollConditionRule[]>([]);

  const [ruleAssignments, setRuleAssignments] = useState<PayrollRuleAssignmentRow[]>([]);
  const [assignRuleId, setAssignRuleId] = useState("");
  const [assignRuleEffectiveFrom, setAssignRuleEffectiveFrom] = useState(todayStr);
  const [assigningRule, setAssigningRule] = useState(false);

  // Attendance Deduction Rules list -- create form lives in
  // components/payroll/AttendanceDeductionRulesBuilder.tsx; this state
  // stays here for the per-type assignment dropdowns below. MULTIPLE
  // concurrent assignments per employee are allowed (opt into Late
  // Coming without Sandwich Leave, or both), so "current" is resolved
  // per rule_type, not as one single latest row. A bare unassign row
  // (rule_id = null) carries no type of its own -- currentAttRuleForType()
  // deliberately resolves that conservatively (fails toward "None"
  // rather than a stale "Assigned") by unioning null rows into every
  // type's candidate set; see the function itself.
  const [attendanceRules, setAttendanceRules] = useState<AttendanceRule[]>([]);

  const [attRuleAssignments, setAttRuleAssignments] = useState<AttendanceRuleAssignmentRow[]>([]);
  const [assignLateRuleId, setAssignLateRuleId] = useState("");
  const [assignSandwichRuleId, setAssignSandwichRuleId] = useState("");
  const [attAssignEffectiveFrom, setAttAssignEffectiveFrom] = useState(todayStr);
  const [assigningAttRule, setAssigningAttRule] = useState(false);

  // Booking sale-value entry -- feeds Payroll's Compute step (commission
  // math and, indirectly, condition-rule booking counts, though that
  // metric reads leads directly, not this table -- see
  // lib/computePayrollAdjustments.ts). HR logs it, not Payroll or Sales:
  // this project has no dedicated deal-value field anywhere else, and
  // this is the simplest place to put entry for it without a bigger
  // Sales-side feature. Scoped to leads already marked CONVERTED +
  // BOOKING for the selected employee, so HR can only log a sale value
  // against a lead that's actually been booked.
  const [employeeLeads, setEmployeeLeads] = useState<LeadOption[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [bookingSaleValue, setBookingSaleValue] = useState("");
  const [bookingDate, setBookingDate] = useState(todayStr);
  const [savingBooking, setSavingBooking] = useState(false);
  const [employeeBookings, setEmployeeBookings] = useState<BookingRow[]>([]);

  // Company-wide "who still needs a sale value logged" -- every
  // CONVERTED/BOOKING lead with no matching bookings row. Booking COUNT
  // (for condition rules) updates the instant a lead is marked booked;
  // the sale VALUE (for commission) requires this separate manual HR
  // step with no reminder otherwise, so commission can silently stay
  // Rs. 0 for weeks with nothing surfacing it. Same "overview card"
  // pattern as Basic Pay Overview above.
  const [missingSaleValueLeads, setMissingSaleValueLeads] = useState<MissingSaleValueLead[]>([]);

  useEffect(() => {
    loadEmployees();
    loadCommissionPlans();
    loadConditionRules();
    loadAttendanceRules();
    loadMissingSaleValueLeads();
  }, []);

  useEffect(() => {
    if (employeeId) {
      loadHistory(employeeId);
      loadPayrollDetails(employeeId);
      loadCommissionAssignments(employeeId);
      loadRuleAssignments(employeeId);
      loadAttRuleAssignments(employeeId);
      loadEmployeeLeads(employeeId);
      loadEmployeeBookings(employeeId);
    } else {
      setHistory([]);
      setPayrollForm(BLANK_PAYROLL_DETAILS);
      setCommissionAssignments([]);
      setRuleAssignments([]);
      setAttRuleAssignments([]);
      setEmployeeLeads([]);
      setEmployeeBookings([]);
    }
  }, [employeeId]);

  async function loadEmployeeLeads(empId: string) {
    const [{ data }, { data: bookingRows }] = await Promise.all([
      supabase.from("leads").select("id, name, mobile").eq("current_owner_id", empId).eq("status", "CONVERTED").eq("board_stage", "BOOKING").order("name"),
      supabase.from("bookings").select("lead_id").eq("employee_id", empId)
    ]);
    // Excludes leads that already have a sale value logged -- a lead
    // should only ever get one bookings row, this keeps the dropdown
    // from making it easy to accidentally log a second one.
    const loggedLeadIds = new Set((bookingRows || []).map((b) => b.lead_id));
    setEmployeeLeads((data || []).filter((l) => !loggedLeadIds.has(l.id)));
  }

  async function loadEmployeeBookings(empId: string) {
    const { data } = await supabase
      .from("bookings")
      .select("id, sale_value, booked_at, lead:leads(name)")
      .eq("employee_id", empId)
      .order("booked_at", { ascending: false });
    setEmployeeBookings((data || []) as unknown as BookingRow[]);
  }

  // leads is in CLAUDE.md's large-table allowlist -- fetchAllRows, not a
  // bare .select(), even though this filtered CONVERTED/BOOKING subset
  // is realistically small today.
  async function loadMissingSaleValueLeads() {
    const { data: bookedLeads } = await fetchAllRows(
      () =>
        supabase
          .from("leads")
          .select("id, name, mobile, current_owner_id, board_stage_changed_at", { count: "exact" })
          .eq("status", "CONVERTED")
          .eq("board_stage", "BOOKING")
          .order("id"),
      { anomalyContext: { supabase, source: "hr_salary_missing_sale_value" } }
    );
    const { data: bookingRows } = await supabase.from("bookings").select("lead_id");
    const loggedLeadIds = new Set((bookingRows || []).map((b) => b.lead_id));
    setMissingSaleValueLeads((bookedLeads || []).filter((l) => !loggedLeadIds.has(l.id)));
  }

  async function handleLogBooking() {
    if (!employeeId) return;
    if (!selectedLeadId) {
      toast.error("Select a booked lead.");
      return;
    }
    const amount = Number(bookingSaleValue);
    if (!amount || amount <= 0) {
      toast.error("Enter a valid sale value.");
      return;
    }
    if (!bookingDate) {
      toast.error("Pick a booking date.");
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

    setSavingBooking(true);
    const { error } = await supabase.from("bookings").insert({
      lead_id: selectedLeadId,
      employee_id: employeeId,
      sale_value: amount,
      booked_at: `${bookingDate}T00:00:00`,
      created_by_employee_id: me.id
    });
    setSavingBooking(false);

    if (error) {
      toast.error(error.message || "Could not log booking.");
      return;
    }

    toast.success("Booking logged.");
    setSelectedLeadId("");
    setBookingSaleValue("");
    loadEmployeeBookings(employeeId);
    loadEmployeeLeads(employeeId);
    loadMissingSaleValueLeads();
  }

  async function loadAttendanceRules() {
    const { data } = await supabase.from("attendance_deduction_rules").select("id, name, rule_type, created_at").order("created_at", { ascending: false });
    setAttendanceRules((data || []) as AttendanceRule[]);
  }

  async function loadAttRuleAssignments(empId: string) {
    const { data } = await supabase
      .from("employee_attendance_deduction_rule_assignments")
      .select(
        "id, rule_id, effective_from, rule:attendance_deduction_rules(name, rule_type), assigned_by:employees!employee_attendance_deduction_rule_assigned_by_employee_id_fkey(name)"
      )
      .eq("employee_id", empId)
      .order("effective_from", { ascending: false });
    setAttRuleAssignments((data || []) as unknown as AttendanceRuleAssignmentRow[]);
  }

  async function handleAssignAttendanceRule(ruleId: string) {
    if (!employeeId) return;
    if (!attAssignEffectiveFrom) {
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

    setAssigningAttRule(true);
    const { error } = await supabase.from("employee_attendance_deduction_rule_assignments").insert({
      employee_id: employeeId,
      rule_id: ruleId || null,
      effective_from: attAssignEffectiveFrom,
      assigned_by_employee_id: me.id
    });
    setAssigningAttRule(false);

    if (error) {
      toast.error(error.message || "Could not save assignment.");
      return;
    }

    toast.success(ruleId ? "Attendance deduction rule assigned." : "Attendance deduction rule unassigned.");
    loadAttRuleAssignments(employeeId);
  }

  // See the state-block comment above -- unions null (unassign) rows
  // into every type's candidate set, so an unassign always wins ties
  // rather than risk showing a stale "Assigned" for a type it might
  // actually belong to.
  function currentAttRuleForType(type: AttendanceRuleType): AttendanceRuleAssignmentRow | null {
    const relevant = attRuleAssignments.filter((a) => a.effective_from <= todayStr && (a.rule_id === null || a.rule?.rule_type === type));
    return relevant[0] || null;
  }

  async function loadConditionRules() {
    const [{ data: rules }, { data: tiers }] = await Promise.all([
      supabase.from("payroll_condition_rules").select("id, name, metric, refund_on_recovery, created_at").order("created_at", { ascending: false }),
      supabase.from("payroll_condition_rule_tiers").select("id, rule_id, min_metric_value, salary_percent, sort_order").order("sort_order")
    ]);
    const tiersByRule: Record<string, PayrollConditionRuleTier[]> = {};
    for (const t of (tiers || []) as PayrollConditionRuleTier[]) {
      (tiersByRule[t.rule_id] ||= []).push(t);
    }
    setConditionRules((rules || []).map((r) => ({ ...r, tiers: tiersByRule[r.id] || [] })));
  }

  async function loadRuleAssignments(empId: string) {
    const { data } = await supabase
      .from("employee_payroll_rule_assignments")
      .select(
        "id, rule_id, effective_from, rule:payroll_condition_rules(name), assigned_by:employees!employee_payroll_rule_assignments_assigned_by_employee_id_fkey(name)"
      )
      .eq("employee_id", empId)
      .order("effective_from", { ascending: false });
    setRuleAssignments((data || []) as unknown as PayrollRuleAssignmentRow[]);
  }

  async function handleAssignConditionRule() {
    if (!employeeId) return;
    if (!assignRuleEffectiveFrom) {
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

    setAssigningRule(true);
    const { error } = await supabase.from("employee_payroll_rule_assignments").insert({
      employee_id: employeeId,
      rule_id: assignRuleId || null,
      effective_from: assignRuleEffectiveFrom,
      assigned_by_employee_id: me.id
    });
    setAssigningRule(false);

    if (error) {
      toast.error(error.message || "Could not save assignment.");
      return;
    }

    toast.success(assignRuleId ? "Payroll condition rule assigned." : "Payroll condition rule unassigned.");
    loadRuleAssignments(employeeId);
  }

  async function loadCommissionPlans() {
    const [{ data: plans }, { data: tiers }] = await Promise.all([
      supabase.from("commission_plans").select("id, name, created_at").order("created_at", { ascending: false }),
      supabase.from("commission_plan_tiers").select("id, plan_id, min_bookings, rate_type, rate_value, sort_order").order("sort_order")
    ]);
    const tiersByPlan: Record<string, CommissionPlanTier[]> = {};
    for (const t of (tiers || []) as CommissionPlanTier[]) {
      (tiersByPlan[t.plan_id] ||= []).push(t);
    }
    setCommissionPlans((plans || []).map((p) => ({ ...p, tiers: tiersByPlan[p.id] || [] })));
  }

  async function loadCommissionAssignments(empId: string) {
    const { data } = await supabase
      .from("employee_commission_plan_assignments")
      .select(
        "id, plan_id, effective_from, plan:commission_plans(name), assigned_by:employees!employee_commission_plan_assignmen_assigned_by_employee_id_fkey(name)"
      )
      .eq("employee_id", empId)
      .order("effective_from", { ascending: false });
    setCommissionAssignments((data || []) as unknown as CommissionAssignmentRow[]);
  }


  async function handleAssignCommissionPlan() {
    if (!employeeId) return;
    if (!assignPlanEffectiveFrom) {
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

    setAssigningPlan(true);
    const { error } = await supabase.from("employee_commission_plan_assignments").insert({
      employee_id: employeeId,
      plan_id: assignPlanId || null,
      effective_from: assignPlanEffectiveFrom,
      assigned_by_employee_id: me.id
    });
    setAssigningPlan(false);

    if (error) {
      toast.error(error.message || "Could not save assignment.");
      return;
    }

    toast.success(assignPlanId ? "Commission plan assigned." : "Commission plan unassigned.");
    loadCommissionAssignments(employeeId);
  }

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

  const currentBasicPay = history.find((h) => h.effective_from <= todayStr)?.basic_pay ?? null;
  const currentCommissionAssignment = commissionAssignments.find((a) => a.effective_from <= todayStr) || null;
  const currentRuleAssignment = ruleAssignments.find((a) => a.effective_from <= todayStr) || null;
  const currentLateRule = currentAttRuleForType("LATE_COMING_THRESHOLD");
  const currentSandwichRule = currentAttRuleForType("SANDWICH_LEAVE");

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

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <IndianRupee size={20} className="text-emerald-600" />
          Salary
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Set Basic Pay, commission plans, condition rules, and attendance deduction rules — Payroll reads all of this to issue slips.
        </p>
      </div>

      <CompanyRegistrationDetails />

      <CommissionPlansBuilder onCreated={loadCommissionPlans} />

      <PayrollConditionRulesBuilder onCreated={loadConditionRules} />

      <AttendanceDeductionRulesBuilder onCreated={loadAttendanceRules} />

      <BasicPayOverview employeeId={employeeId} onSavedForEmployee={() => loadHistory(employeeId)} />

      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
        <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
          <AlertTriangle size={15} className="text-amber-500" /> Bookings Missing Sale Value ({missingSaleValueLeads.length})
        </p>
        <p className="text-xs text-slate-500 -mt-2">
          Leads already marked Converted / Booking with no sale value logged yet — their commission stays Rs. 0 until you log one below.
          Click a row to jump straight to that employee's Log Booking section.
        </p>

        {missingSaleValueLeads.length === 0 ? (
          <p className="text-xs text-slate-400">Every booked lead has a sale value logged.</p>
        ) : (
          <div className="max-h-56 overflow-y-auto space-y-1.5">
            {missingSaleValueLeads.map((l) => {
              const owner = employees.find((e) => e.id === l.current_owner_id);
              return (
                <button
                  key={l.id}
                  onClick={() => setEmployeeId(l.current_owner_id || "")}
                  disabled={!l.current_owner_id}
                  className="flex items-center gap-3 text-xs w-full text-left rounded-lg px-2 py-1.5 hover:bg-amber-50 transition disabled:hover:bg-transparent disabled:cursor-default"
                >
                  <span className="flex-1 text-slate-700 font-semibold truncate">
                    {l.name} <span className="text-slate-400 font-normal">({l.mobile})</span>
                  </span>
                  <span className="text-slate-500">{owner?.name || "Unowned"}</span>
                  <span className="text-slate-400 w-24 shrink-0 text-right">
                    {l.board_stage_changed_at ? new Date(l.board_stage_changed_at).toLocaleDateString("en-IN") : "—"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
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
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-slate-800">Commission Plan Assignment</p>
              <p className="text-sm font-bold text-violet-600">Current: {currentCommissionAssignment?.plan?.name || "None"}</p>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-500">Plan</label>
                <select
                  value={assignPlanId}
                  onChange={(e) => setAssignPlanId(e.target.value)}
                  className="mt-1 h-9 w-56 rounded-lg bg-slate-50 border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-violet-100 focus:border-violet-300"
                >
                  <option value="">— Unassign —</option>
                  {commissionPlans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500">Effective From</label>
                <DateInput value={assignPlanEffectiveFrom} onChange={setAssignPlanEffectiveFrom} />
              </div>
              <button
                onClick={handleAssignCommissionPlan}
                disabled={assigningPlan}
                className="h-9 px-4 rounded-xl bg-violet-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-violet-700 transition"
              >
                {assigningPlan ? "Saving..." : "Assign"}
              </button>
            </div>

            {commissionAssignments.length > 0 && (
              <div className="pt-2 border-t border-slate-100 space-y-1.5">
                {commissionAssignments.map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-xs">
                    <span className="text-slate-600">
                      From {a.effective_from} — {a.plan?.name || "Unassigned"}
                    </span>
                    <span className="text-slate-400">by {a.assigned_by?.name || "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-slate-800">Payroll Condition Rule Assignment</p>
              <p className="text-sm font-bold text-rose-600">Current: {currentRuleAssignment?.rule?.name || "None"}</p>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-500">Rule</label>
                <select
                  value={assignRuleId}
                  onChange={(e) => setAssignRuleId(e.target.value)}
                  className="mt-1 h-9 w-56 rounded-lg bg-slate-50 border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-rose-100 focus:border-rose-300"
                >
                  <option value="">— Unassign —</option>
                  {conditionRules.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500">Effective From</label>
                <DateInput value={assignRuleEffectiveFrom} onChange={setAssignRuleEffectiveFrom} />
              </div>
              <button
                onClick={handleAssignConditionRule}
                disabled={assigningRule}
                className="h-9 px-4 rounded-xl bg-rose-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-rose-700 transition"
              >
                {assigningRule ? "Saving..." : "Assign"}
              </button>
            </div>

            {ruleAssignments.length > 0 && (
              <div className="pt-2 border-t border-slate-100 space-y-1.5">
                {ruleAssignments.map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-xs">
                    <span className="text-slate-600">
                      From {a.effective_from} — {a.rule?.name || "Unassigned"}
                    </span>
                    <span className="text-slate-400">by {a.assigned_by?.name || "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
            <p className="text-sm font-bold text-slate-800">Attendance Deduction Rule Assignment</p>
            <p className="text-xs text-slate-500 -mt-2">Opt-in — leave both unassigned for a flat-salary employee with no attendance deductions.</p>

            <div>
              <label className="text-xs font-semibold text-slate-500">Effective From (applies to whichever you assign below)</label>
              <DateInput value={attAssignEffectiveFrom} onChange={setAttAssignEffectiveFrom} />
            </div>

            {(
              [
                ["LATE_COMING_THRESHOLD", currentLateRule, assignLateRuleId, setAssignLateRuleId] as const,
                ["SANDWICH_LEAVE", currentSandwichRule, assignSandwichRuleId, setAssignSandwichRuleId] as const
              ]
            ).map(([type, current, selected, setSelected]) => (
              <div key={type} className="flex flex-wrap items-end gap-3 pt-2 border-t border-slate-100">
                <div className="w-32">
                  <p className="text-xs font-bold text-slate-600">{ATTENDANCE_RULE_TYPE_LABELS[type]}</p>
                  <p className="text-xs font-bold text-cyan-600">{current?.rule?.name || "None"}</p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500">Rule</label>
                  <select
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                    className="mt-1 h-9 w-56 rounded-lg bg-slate-50 border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-cyan-100 focus:border-cyan-300"
                  >
                    <option value="">— Unassign —</option>
                    {attendanceRules
                      .filter((r) => r.rule_type === type)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                  </select>
                </div>
                <button
                  onClick={() => handleAssignAttendanceRule(selected)}
                  disabled={assigningAttRule}
                  className="h-9 px-4 rounded-xl bg-cyan-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-cyan-700 transition"
                >
                  {assigningAttRule ? "Saving..." : "Assign"}
                </button>
              </div>
            ))}

            {attRuleAssignments.length > 0 && (
              <div className="pt-2 border-t border-slate-100 space-y-1.5">
                {attRuleAssignments.map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-xs">
                    <span className="text-slate-600">
                      From {a.effective_from} — {a.rule ? `${a.rule.name} (${ATTENDANCE_RULE_TYPE_LABELS[a.rule.rule_type]})` : "Unassigned"}
                    </span>
                    <span className="text-slate-400">by {a.assigned_by?.name || "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
            <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <Briefcase size={15} className="text-emerald-600" /> Log Booking
            </p>
            <p className="text-xs text-slate-500 -mt-2">
              Records the sale value behind one of this employee's booked leads — feeds Payroll's commission calculation. Only shows
              leads already marked Converted / Booking.
            </p>

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-500">Booked Lead</label>
                <select
                  value={selectedLeadId}
                  onChange={(e) => setSelectedLeadId(e.target.value)}
                  className="mt-1 h-9 w-56 rounded-lg bg-slate-50 border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-300"
                >
                  <option value="">{employeeLeads.length === 0 ? "No booked leads" : "Select lead"}</option>
                  {employeeLeads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.mobile})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500">Sale Value (Rs.)</label>
                <input
                  type="number"
                  min={0}
                  value={bookingSaleValue}
                  onChange={(e) => setBookingSaleValue(e.target.value)}
                  placeholder="e.g. 2500000"
                  className="mt-1 h-9 w-40 rounded-lg bg-slate-50 border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-300"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500">Booking Date</label>
                <DateInput value={bookingDate} onChange={setBookingDate} />
              </div>
              <button
                onClick={handleLogBooking}
                disabled={savingBooking}
                className="h-9 px-4 rounded-xl bg-emerald-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-emerald-700 transition"
              >
                {savingBooking ? "Saving..." : "Log Booking"}
              </button>
            </div>

            {employeeBookings.length > 0 && (
              <div className="pt-2 border-t border-slate-100 space-y-1.5">
                {employeeBookings.map((b) => (
                  <div key={b.id} className="flex items-center justify-between text-xs">
                    <span className="text-slate-600">
                      {b.booked_at.slice(0, 10)} — {b.lead?.name || "—"}
                    </span>
                    <span className="font-bold text-emerald-600">Rs. {formatINR(b.sale_value)}</span>
                  </div>
                ))}
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
        </>
      )}
    </motion.div>
  );
}
