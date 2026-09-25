"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { FileSpreadsheet, FileText, Clock, UserCheck, Share2 } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import DateInput from "@/components/DateInput";
import { formatTimeStringAsClock } from "@/lib/istTime";
import {
  calculateDailyHrmsStatus,
  applyMonthlyLateComingRule,
  DailyHrmsStatus,
  MonthlyHrmsStatus
} from "@/lib/calculateHrmsAttendanceStatus";
import {
  exportAttendanceDetailToExcel,
  exportAttendanceDetailToPDF,
  exportAttendanceSummaryToExcel,
  exportAttendanceSummaryToPDF,
  AttendanceDetailExportRow,
  AttendanceSummaryExportRow
} from "@/lib/exportAttendanceReport";
import { STATUS_DISPLAY, STATUS_DOT, dateRangeArray } from "@/lib/hrmsAttendanceDisplay";

interface EmployeeRow {
  id: string;
  name: string;
}

interface AttendanceRow {
  employee_id: string;
  date: string;
  shift_start_at: string;
  attendance_type: "FULL_DAY" | "HALF_DAY_SECOND" | "HALF_DAY_FIRST" | null;
}

interface OverrideRow {
  employee_id: string;
  date: string;
  marked_status: "PRESENT" | "ABSENT";
  marked_by: { name: string } | null;
}

const TEAL_DATE_INPUT_CLASS =
  "h-10 w-full rounded-xl bg-slate-50 border border-slate-200 pl-3 pr-9 text-xs font-semibold text-slate-600 outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-300 transition cursor-pointer";

// Daily/Range view: per-employee-per-day status across a From-To range
// (defaults to today-today, so it behaves exactly like the original
// single-day view unless widened) + the manual-override action for any
// (employee, date) with no row yet. Monthly view: the shared
// late-coming counter actually applied, per employee, for reporting.
// Both reuse the exact same pure calculateHrmsAttendanceStatus
// functions, no duplicated logic between the two views, and both
// export through the same generic exportTable.ts engine the Leads
// report already uses.
export default function HrAttendancePage() {
  const todayStr = new Date().toISOString().slice(0, 10);

  const [viewMode, setViewMode] = useState<"DAILY" | "MONTHLY">("DAILY");
  const [dateFrom, setDateFrom] = useState(todayStr);
  const [dateTo, setDateTo] = useState(todayStr);
  const [selectedMonth, setSelectedMonth] = useState(todayStr.slice(0, 7));
  const [employeeFilter, setEmployeeFilter] = useState("");

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [settings, setSettings] = useState<{ first_half_ontime_cutoff: string; second_half_ontime_cutoff: string } | null>(null);
  const [weeklyOffDay, setWeeklyOffDay] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [myEmployeeId, setMyEmployeeId] = useState("");
  const [sharing, setSharing] = useState(false);

  const [rangeAttendance, setRangeAttendance] = useState<AttendanceRow[]>([]);
  const [rangeOverrides, setRangeOverrides] = useState<OverrideRow[]>([]);
  const [monthlyAttendance, setMonthlyAttendance] = useState<AttendanceRow[]>([]);

  const [overrideFormKey, setOverrideFormKey] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);

  useEffect(() => {
    loadStatic();
    loadSelf();
  }, []);

  useEffect(() => {
    if (viewMode === "DAILY") loadRange();
  }, [dateFrom, dateTo, viewMode]);

  useEffect(() => {
    if (viewMode === "MONTHLY") loadMonthly();
  }, [selectedMonth, viewMode]);

  async function loadStatic() {
    const [{ data: emp }, { data: set }, { data: les }] = await Promise.all([
      supabase.from("employees").select("id, name").eq("is_active", true).order("name"),
      supabase.from("hrms_settings").select("first_half_ontime_cutoff, second_half_ontime_cutoff").eq("id", 1).single(),
      supabase.from("lead_engine_settings").select("sla_weekly_off_day").eq("id", 1).single()
    ]);
    if (emp) setEmployees(emp);
    if (set) setSettings(set);
    if (les) setWeeklyOffDay(les.sla_weekly_off_day ?? 0);
    setLoading(false);
  }

  async function loadSelf() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from("employees").select("id").eq("auth_user_id", user.id).single();
    if (data) setMyEmployeeId(data.id);
  }

  // Attendance Sharing (Phase 5, 2026-09-25) -- attendance_shares is a
  // pure, immutable audit log (who shared what range with whom, and
  // when) -- the employee's own read-only view (app/attendance/
  // page.tsx) recomputes the actual day-by-day status live from the
  // same attendance table + calculateDailyHrmsStatus this page already
  // uses, scoped to the shared date_from/date_to. No status snapshot
  // is stored here, so a later manual override never goes stale on
  // the employee's side.
  async function handleShareRange() {
    if (!employeeFilter) {
      toast.error("Pick a specific employee first.");
      return;
    }
    if (!myEmployeeId) {
      toast.error("Could not identify your employee record.");
      return;
    }

    setSharing(true);
    const { error } = await supabase.from("attendance_shares").insert({
      employee_id: employeeFilter,
      shared_by_employee_id: myEmployeeId,
      date_from: dateFrom,
      date_to: dateTo
    });
    setSharing(false);

    if (error) {
      toast.error(error.message || "Could not share attendance.");
      return;
    }
    toast.success(`Attendance shared with ${employeeFilterLabel}.`);
  }

  async function loadRange() {
    const [{ data: att }, { data: ov }] = await Promise.all([
      supabase.from("attendance").select("employee_id, date, shift_start_at, attendance_type").gte("date", dateFrom).lte("date", dateTo),
      supabase
        .from("hrms_attendance_overrides")
        .select("employee_id, date, marked_status, marked_by:employees!hrms_attendance_overrides_marked_by_employee_id_fkey(name)")
        .gte("date", dateFrom)
        .lte("date", dateTo)
    ]);
    setRangeAttendance((att || []) as AttendanceRow[]);
    setRangeOverrides((ov || []) as unknown as OverrideRow[]);
  }

  async function loadMonthly() {
    const start = `${selectedMonth}-01`;
    const endDate = new Date(start);
    endDate.setMonth(endDate.getMonth() + 1);
    endDate.setDate(0);
    const end = endDate.toISOString().slice(0, 10);

    const { data: att } = await supabase
      .from("attendance")
      .select("employee_id, date, shift_start_at, attendance_type")
      .gte("date", start)
      .lte("date", end);

    setMonthlyAttendance((att || []) as AttendanceRow[]);
  }

  const filteredEmployees = useMemo(
    () => (employeeFilter ? employees.filter((e) => e.id === employeeFilter) : employees),
    [employees, employeeFilter]
  );

  // Flattened employee x date rows for the selected range -- no
  // weekly-off exclusion here, matching the original single-day view's
  // behavior exactly (Admin/HR simply wouldn't pick a non-working day
  // to check "who's here today"); only the Monthly Summary rollup
  // (which existed before this change) excludes weekly-offs, unchanged.
  const rangeRows = useMemo(() => {
    if (!settings) return [];
    const dates = dateRangeArray(dateFrom, dateTo);

    const rows: {
      employee: EmployeeRow;
      date: string;
      status: DailyHrmsStatus;
      row: AttendanceRow | null;
      override: OverrideRow | null;
    }[] = [];

    for (const emp of filteredEmployees) {
      for (const date of dates) {
        const row = rangeAttendance.find((a) => a.employee_id === emp.id && a.date === date) || null;
        const status = calculateDailyHrmsStatus(row, settings);
        const override = rangeOverrides.find((o) => o.employee_id === emp.id && o.date === date) || null;
        rows.push({ employee: emp, date, status, row, override });
      }
    }

    return rows;
  }, [filteredEmployees, rangeAttendance, rangeOverrides, settings, dateFrom, dateTo]);

  // Working days = every day in the selected month up to today (or the
  // whole month, if a past month) that isn't the configured weekly-off
  // day -- same sla_weekly_off_day lead_engine_settings already uses
  // for SLA-deadline math (Golden Rule: reused, not reinvented here).
  const monthlyRows = useMemo(() => {
    if (!settings) return [];

    const [y, m] = selectedMonth.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const isCurrentMonth = selectedMonth === todayStr.slice(0, 7);
    const lastDay = isCurrentMonth ? new Date().getDate() : daysInMonth;

    const workingDates: string[] = [];
    for (let d = 1; d <= lastDay; d++) {
      if (new Date(y, m - 1, d).getDay() === weeklyOffDay) continue;
      workingDates.push(`${selectedMonth}-${String(d).padStart(2, "0")}`);
    }

    return filteredEmployees.map((emp) => {
      const daily: DailyHrmsStatus[] = workingDates.map((date) => {
        const row = monthlyAttendance.find((a) => a.employee_id === emp.id && a.date === date) || null;
        return calculateDailyHrmsStatus(row, settings);
      });

      const monthly = applyMonthlyLateComingRule(daily);
      const counts: Record<MonthlyHrmsStatus, number> = { ON_TIME: 0, LATE_COMING: 0, HALF_DAY: 0, ABSENT: 0 };
      monthly.forEach((s) => counts[s]++);

      return { employee: emp, counts };
    });
  }, [filteredEmployees, monthlyAttendance, settings, selectedMonth, weeklyOffDay, todayStr]);

  // Headline counts for the hero strip -- reflects whichever view/
  // range/filter is currently active, same "describes what's on
  // screen right now" convention as the rest of this module's stat
  // strips (not a separate, independently-scoped query).
  const statusCounts = useMemo(() => {
    const counts: Record<MonthlyHrmsStatus, number> = { ON_TIME: 0, LATE_COMING: 0, HALF_DAY: 0, ABSENT: 0 };
    if (viewMode === "DAILY") {
      rangeRows.forEach((r) => { counts[r.status]++; });
    } else {
      monthlyRows.forEach((r) => {
        counts.ON_TIME += r.counts.ON_TIME;
        counts.LATE_COMING += r.counts.LATE_COMING;
        counts.HALF_DAY += r.counts.HALF_DAY;
        counts.ABSENT += r.counts.ABSENT;
      });
    }
    return counts;
  }, [viewMode, rangeRows, monthlyRows]);

  async function submitOverride(employeeId: string, date: string, status: "PRESENT" | "ABSENT") {
    if (!overrideReason.trim()) {
      toast.error("A reason is required.");
      return;
    }

    setOverrideSubmitting(true);
    try {
      const { error } = await supabase.rpc("mark_hrms_attendance_manual_atomic", {
        p_employee_id: employeeId,
        p_date: date,
        p_status: status,
        p_reason: overrideReason.trim()
      });

      if (error) {
        toast.error(error.message || "Could not mark attendance.");
        return;
      }

      toast.success(`Marked ${status === "PRESENT" ? "Present" : "Absent"}.`);
      setOverrideFormKey(null);
      setOverrideReason("");
      loadRange();
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong.");
    } finally {
      setOverrideSubmitting(false);
    }
  }

  const employeeFilterLabel = employeeFilter ? employees.find((e) => e.id === employeeFilter)?.name ?? null : null;

  async function handleExportRange(format: "excel" | "pdf") {
    if (rangeRows.length === 0 || exporting) return;

    setExporting(true);
    try {
      const rows: AttendanceDetailExportRow[] = rangeRows.map((r) => ({
        employeeName: r.employee.name,
        date: r.date,
        status: r.status,
        shiftStartAt: r.row?.shift_start_at ?? null,
        half: r.row ? (r.row.attendance_type === "HALF_DAY_SECOND" ? "SECOND" : "FIRST") : null,
        manuallyMarkedBy: r.override?.marked_by?.name ?? null
      }));

      const meta = {
        employeeLabel: employeeFilterLabel,
        otherFilters: [{ label: "Date Range", value: dateFrom === dateTo ? dateFrom : `${dateFrom} to ${dateTo}` }]
      };

      if (format === "excel") {
        await exportAttendanceDetailToExcel(rows, meta);
      } else {
        await exportAttendanceDetailToPDF(rows, meta);
      }
    } catch (err) {
      console.error(err);
      toast.error("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  async function handleExportMonthly(format: "excel" | "pdf") {
    if (monthlyRows.length === 0 || exporting) return;

    setExporting(true);
    try {
      const rows: AttendanceSummaryExportRow[] = monthlyRows.map((r) => ({
        employeeName: r.employee.name,
        counts: r.counts
      }));

      const meta = {
        employeeLabel: employeeFilterLabel,
        otherFilters: [{ label: "Month", value: selectedMonth }]
      };

      if (format === "excel") {
        await exportAttendanceSummaryToExcel(rows, meta);
      } else {
        await exportAttendanceSummaryToPDF(rows, meta);
      }
    } catch (err) {
      console.error(err);
      toast.error("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6 pb-10">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-teal-700 via-emerald-600 to-teal-500 text-white p-5 sm:p-6"
      >
        <Clock size={170} strokeWidth={1.1} className="absolute -right-8 -bottom-12 text-white/10 pointer-events-none hidden sm:block" />

        <div className="relative">
          <p className="text-[10px] font-semibold tracking-[0.2em] text-teal-100 uppercase mb-2">HR Attendance</p>
          <h1 className="text-xl sm:text-2xl font-bold">Attendance Tracking</h1>
          <p className="text-sm text-white/70 mt-1">
            Independent strict on-time cutoffs ({settings?.first_half_ontime_cutoff?.slice(0, 5)} / {settings?.second_half_ontime_cutoff?.slice(0, 5)}) — separate from the Lead-Distribution shift window.
          </p>
        </div>

        <div className="relative flex items-center gap-2.5 flex-wrap mt-5">
          <div className="flex items-baseline gap-1.5 bg-white/10 border border-white/15 rounded-xl px-3.5 py-2">
            <span className="text-lg font-bold leading-none">{statusCounts.ON_TIME}</span>
            <span className="text-[11px] text-white/70 font-semibold">On Time</span>
          </div>
          <div className="flex items-baseline gap-1.5 bg-white/10 border border-white/15 rounded-xl px-3.5 py-2">
            <span className="text-lg font-bold leading-none">{statusCounts.LATE_COMING}</span>
            <span className="text-[11px] text-white/70 font-semibold">Late Coming</span>
          </div>
          <div className="flex items-baseline gap-1.5 bg-white/10 border border-white/15 rounded-xl px-3.5 py-2">
            <span className="text-lg font-bold leading-none">{statusCounts.HALF_DAY}</span>
            <span className="text-[11px] text-white/70 font-semibold">Half Day</span>
          </div>
          <div className="flex items-baseline gap-1.5 bg-white/10 border border-white/15 rounded-xl px-3.5 py-2">
            <span className="text-lg font-bold leading-none">{statusCounts.ABSENT}</span>
            <span className="text-[11px] text-white/70 font-semibold">Absent</span>
          </div>
        </div>
      </motion.div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-[0_4px_20px_rgba(15,23,42,0.06)] p-3 flex flex-wrap items-center gap-2.5">
        <div className="flex rounded-xl bg-slate-100 p-1 gap-1">
          <button
            onClick={() => setViewMode("DAILY")}
            className={`px-3.5 h-9 rounded-lg text-xs font-bold transition ${
              viewMode === "DAILY" ? "bg-gradient-to-r from-teal-600 to-emerald-500 text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Daily / Range
          </button>
          <button
            onClick={() => setViewMode("MONTHLY")}
            className={`px-3.5 h-9 rounded-lg text-xs font-bold transition ${
              viewMode === "MONTHLY" ? "bg-gradient-to-r from-teal-600 to-emerald-500 text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Monthly Summary
          </button>
        </div>

        <select
          value={employeeFilter}
          onChange={(e) => setEmployeeFilter(e.target.value)}
          className="h-10 rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs font-semibold text-slate-600 outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-300 transition"
        >
          <option value="">All Employees</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.name}
            </option>
          ))}
        </select>

        {viewMode === "DAILY" ? (
          <div className="flex items-center gap-2">
            <div className="w-[150px]">
              <DateInput value={dateFrom} onChange={setDateFrom} className={TEAL_DATE_INPUT_CLASS} />
            </div>
            <span className="text-xs text-slate-400">to</span>
            <div className="w-[150px]">
              <DateInput value={dateTo} onChange={setDateTo} min={dateFrom} className={TEAL_DATE_INPUT_CLASS} />
            </div>
          </div>
        ) : (
          <div className="w-[170px]">
            <DateInput value={selectedMonth} onChange={setSelectedMonth} mode="month" className={TEAL_DATE_INPUT_CLASS} />
          </div>
        )}

        {viewMode === "DAILY" && employeeFilter && (
          <button
            onClick={handleShareRange}
            disabled={sharing}
            className="flex items-center gap-1.5 h-10 px-3 rounded-xl bg-teal-50 text-teal-700 text-xs font-bold disabled:opacity-40 hover:bg-teal-100 transition"
          >
            <Share2 size={14} />
            {sharing ? "Sharing..." : `Share with ${employeeFilterLabel}`}
          </button>
        )}

        <div className="flex items-center gap-2 sm:ml-auto">
          <button
            onClick={() => (viewMode === "DAILY" ? handleExportRange("excel") : handleExportMonthly("excel"))}
            disabled={exporting}
            className="flex items-center gap-1.5 h-10 px-3 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-bold disabled:opacity-40 hover:bg-emerald-100 transition"
          >
            <FileSpreadsheet size={14} />
            Excel
          </button>
          <button
            onClick={() => (viewMode === "DAILY" ? handleExportRange("pdf") : handleExportMonthly("pdf"))}
            disabled={exporting}
            className="flex items-center gap-1.5 h-10 px-3 rounded-xl bg-red-50 text-red-700 text-xs font-bold disabled:opacity-40 hover:bg-red-100 transition"
          >
            <FileText size={14} />
            PDF
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-sm text-slate-400 py-10">Loading...</div>
      ) : viewMode === "DAILY" ? (
        <div className="rounded-[24px] bg-white border border-slate-100 shadow-[0_4px_20px_rgba(15,23,42,0.06)] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-500 font-bold">
                <th className="p-3.5">Employee</th>
                <th className="p-3.5">Date</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Shift Start</th>
                <th className="p-3.5">Manual</th>
                <th className="p-3.5">Action</th>
              </tr>
            </thead>
            <tbody>
              {rangeRows.map(({ employee, date, status, row, override }) => {
                const key = `${employee.id}::${date}`;
                return (
                  <tr key={key} className="border-b border-slate-50 last:border-0 align-top hover:bg-slate-50/60 transition-colors">
                    <td className="p-3.5 font-semibold text-slate-800">{employee.name}</td>
                    <td className="p-3.5 text-slate-500">{new Date(date).toLocaleDateString([], { month: "short", day: "numeric" })}</td>
                    <td className="p-3.5">
                      <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full ${STATUS_DISPLAY[status].className}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
                        {STATUS_DISPLAY[status].label}
                      </span>
                      {status === "LATE_COMING" && settings && row && (
                        <p className="text-[10px] text-slate-400 mt-1">
                          Cutoff:{" "}
                          {formatTimeStringAsClock(
                            row.attendance_type === "HALF_DAY_SECOND"
                              ? settings.second_half_ontime_cutoff
                              : settings.first_half_ontime_cutoff
                          )}
                        </p>
                      )}
                    </td>
                    <td className="p-3.5 text-slate-500">
                      {row
                        ? new Date(row.shift_start_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) +
                          (row.attendance_type === "HALF_DAY_SECOND" ? " (2nd half)" : "")
                        : "—"}
                    </td>
                    <td className="p-3.5 text-slate-500">
                      {override ? (
                        <span className="flex items-center gap-1.5"><UserCheck size={13} className="text-teal-600" /> {override.marked_by?.name || "—"}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="p-3.5">
                      {!row &&
                        (overrideFormKey === key ? (
                          <div className="flex flex-col gap-2 items-start">
                            <input
                              value={overrideReason}
                              onChange={(e) => setOverrideReason(e.target.value)}
                              placeholder="Reason (required)"
                              className="h-9 w-48 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-300 transition"
                            />
                            <div className="flex gap-2">
                              <button
                                disabled={overrideSubmitting}
                                onClick={() => submitOverride(employee.id, date, "PRESENT")}
                                className="text-xs font-bold px-3 py-1.5 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                              >
                                Present
                              </button>
                              <button
                                disabled={overrideSubmitting}
                                onClick={() => submitOverride(employee.id, date, "ABSENT")}
                                className="text-xs font-bold px-3 py-1.5 rounded-full bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-60"
                              >
                                Absent
                              </button>
                              <button
                                disabled={overrideSubmitting}
                                onClick={() => {
                                  setOverrideFormKey(null);
                                  setOverrideReason("");
                                }}
                                className="text-xs font-bold px-3 py-1.5 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-60"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => setOverrideFormKey(key)}
                            className="text-xs font-bold px-3 py-1.5 rounded-full bg-teal-50 text-teal-700 hover:bg-teal-100"
                          >
                            Manual Override
                          </button>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-[24px] bg-white border border-slate-100 shadow-[0_4px_20px_rgba(15,23,42,0.06)] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-500 font-bold">
                <th className="p-3.5">Employee</th>
                <th className="p-3.5">On Time</th>
                <th className="p-3.5">Late Coming (free)</th>
                <th className="p-3.5">Half Day</th>
                <th className="p-3.5">Absent</th>
              </tr>
            </thead>
            <tbody>
              {monthlyRows.map(({ employee, counts }) => (
                <tr key={employee.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60 transition-colors">
                  <td className="p-3.5 font-semibold text-slate-800">{employee.name}</td>
                  <td className="p-3.5 text-emerald-700 font-semibold">{counts.ON_TIME}</td>
                  <td className="p-3.5 text-amber-700 font-semibold">{counts.LATE_COMING}</td>
                  <td className="p-3.5 text-orange-700 font-semibold">{counts.HALF_DAY}</td>
                  <td className="p-3.5 text-red-600 font-semibold">{counts.ABSENT}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
