"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { IndianRupee, AlertTriangle, Briefcase, Cake } from "lucide-react";
import { supabase } from "@/lib/supabase";
import DateInput from "@/components/DateInput";
import { formatINR } from "@/lib/exportTable";
import { fetchAllRows } from "@/lib/fetchAllRows";
import CompanyRegistrationDetails from "@/components/payroll/CompanyRegistrationDetails";
import CommissionPlansBuilder from "@/components/payroll/CommissionPlansBuilder";
import PayrollConditionRulesBuilder from "@/components/payroll/PayrollConditionRulesBuilder";
import AttendanceDeductionRulesBuilder from "@/components/payroll/AttendanceDeductionRulesBuilder";
import BasicPayOverview from "@/components/payroll/BasicPayOverview";
import BasicPaySetForm from "@/components/payroll/BasicPaySetForm";
import CommissionAssignmentForm from "@/components/payroll/CommissionAssignmentForm";
import ConditionRuleAssignmentForm from "@/components/payroll/ConditionRuleAssignmentForm";
import AttendanceRuleAssignmentForm from "@/components/payroll/AttendanceRuleAssignmentForm";
import PayrollDetailsForm from "@/components/payroll/PayrollDetailsForm";

interface EmployeeRow {
  id: string;
  name: string;
  department: string | null;
  role: string;
}

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

// Salary policy/setup. Payroll now has equal write access on every
// table this page touches (RLS was expanded to full HR/Payroll parity),
// so every section here -- company-wide (Company Registration Details,
// Commission Plans, Payroll Condition Rules, Attendance Deduction
// Rules, Basic Pay Overview) and per-employee (Basic Pay set, plan/rule
// assignment, Payroll Details) -- lives in components/payroll/* and is
// mounted on both this page and app/payroll/salary/page.tsx: one owner
// for each, not a second copy kept in sync by hand. Log Booking, the
// Bookings Missing Sale Value overview, and the Date of Birth Overview
// (feeds the birthday celebration toast) stay inline here (and Log
// Booking is duplicated inline on the Payroll page) since they're small
// and don't have the same "shared state read by two different
// displays" staleness risk the extracted forms did.
export default function HrSalaryPage() {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [loading, setLoading] = useState(true);

  // Bumped whenever Basic Pay Overview's bulk-set touches the currently
  // selected employee, forcing BasicPaySetForm to remount (and thus
  // reload its own history) -- the only per-employee section with a
  // SECOND write path into the same table, so it's the only one that
  // needs this vs. just an onSaved callback.
  const [basicPayRefreshNonce, setBasicPayRefreshNonce] = useState(0);

  // Same remount-via-key pattern as basicPayRefreshNonce above, for the
  // same reason: the Date of Birth Overview's bulk-set below is a
  // SECOND write path into employee_payroll_details, the same table
  // PayrollDetailsForm reads/writes for the selected employee.
  const [payrollDetailsRefreshNonce, setPayrollDetailsRefreshNonce] = useState(0);

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
  const [bookingDate, setBookingDate] = useState(new Date().toISOString().slice(0, 10));
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
    loadMissingSaleValueLeads();
    loadAllDob();
  }, []);

  useEffect(() => {
    if (employeeId) {
      loadEmployeeLeads(employeeId);
      loadEmployeeBookings(employeeId);
    } else {
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

  async function loadEmployees() {
    const { data } = await supabase.from("employees").select("id, name, department, role").eq("is_active", true).order("name");
    setEmployees(data || []);
    setLoading(false);
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
    if (employeeId && rows.some(([empId]) => empId === employeeId)) setPayrollDetailsRefreshNonce((n) => n + 1);
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

      <CommissionPlansBuilder />

      <PayrollConditionRulesBuilder />

      <AttendanceDeductionRulesBuilder />

      <BasicPayOverview employeeId={employeeId} onSavedForEmployee={() => setBasicPayRefreshNonce((n) => n + 1)} />

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
          <BasicPaySetForm key={`${employeeId}-${basicPayRefreshNonce}`} employeeId={employeeId} />

          <CommissionAssignmentForm employeeId={employeeId} />

          <ConditionRuleAssignmentForm employeeId={employeeId} />

          <AttendanceRuleAssignmentForm employeeId={employeeId} />

          <PayrollDetailsForm key={`${employeeId}-${payrollDetailsRefreshNonce}`} employeeId={employeeId} />

          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-4">
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
        </>
      )}
    </motion.div>
  );
}
