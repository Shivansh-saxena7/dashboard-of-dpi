"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { FileSpreadsheet, FileText } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
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

const STATUS_DISPLAY: Record<string, { label: string; className: string }> = {
  ON_TIME: { label: "On Time", className: "bg-emerald-50 text-emerald-700" },
  LATE_COMING: { label: "Late Coming", className: "bg-amber-50 text-amber-700" },
  HALF_DAY: { label: "Half Day", className: "bg-orange-100 text-orange-700" },
  ABSENT: { label: "Absent", className: "bg-red-50 text-red-700" }
};

function dateRangeArray(from: string, to: string): string[] {
  const dates: string[] = [];
  const cur = new Date(from);
  const end = new Date(to);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

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

  const [rangeAttendance, setRangeAttendance] = useState<AttendanceRow[]>([]);
  const [rangeOverrides, setRangeOverrides] = useState<OverrideRow[]>([]);
  const [monthlyAttendance, setMonthlyAttendance] = useState<AttendanceRow[]>([]);

  const [overrideFormKey, setOverrideFormKey] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);

  useEffect(() => {
    loadStatic();
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
        className="rounded-[24px] bg-gradient-to-br from-teal-700 via-emerald-600 to-teal-500 text-white p-6"
      >
        <p className="text-[10px] font-semibold tracking-[0.2em] text-teal-100 uppercase mb-2">HR Attendance</p>
        <h1 className="text-xl font-bold">Attendance Tracking</h1>
        <p className="text-sm text-white/70 mt-1">
          Independent strict on-time cutoffs ({settings?.first_half_ontime_cutoff?.slice(0, 5)} / {settings?.second_half_ontime_cutoff?.slice(0, 5)}) — separate from the Lead-Distribution shift window.
        </p>
      </motion.div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-slate-200 overflow-hidden">
          <button
            onClick={() => setViewMode("DAILY")}
            className={`px-4 h-10 text-xs font-bold transition ${viewMode === "DAILY" ? "bg-teal-600 text-white" : "bg-white text-slate-600"}`}
          >
            Daily / Range
          </button>
          <button
            onClick={() => setViewMode("MONTHLY")}
            className={`px-4 h-10 text-xs font-bold transition ${viewMode === "MONTHLY" ? "bg-teal-600 text-white" : "bg-white text-slate-600"}`}
          >
            Monthly Summary
          </button>
        </div>

        <select
          value={employeeFilter}
          onChange={(e) => setEmployeeFilter(e.target.value)}
          className="h-10 rounded-xl bg-white border border-slate-200 px-3 text-xs font-semibold text-slate-600 outline-none"
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
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-10 rounded-xl bg-white border border-slate-200 px-3 text-xs font-semibold text-slate-600 outline-none"
            />
            <span className="text-xs text-slate-400">to</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-10 rounded-xl bg-white border border-slate-200 px-3 text-xs font-semibold text-slate-600 outline-none"
            />
          </div>
        ) : (
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="h-10 rounded-xl bg-white border border-slate-200 px-3 text-xs font-semibold text-slate-600 outline-none"
          />
        )}

        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => (viewMode === "DAILY" ? handleExportRange("excel") : handleExportMonthly("excel"))}
            disabled={exporting}
            className="flex items-center gap-1.5 h-10 px-3 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold disabled:opacity-40 hover:bg-emerald-100 transition"
          >
            <FileSpreadsheet size={14} />
            Excel
          </button>
          <button
            onClick={() => (viewMode === "DAILY" ? handleExportRange("pdf") : handleExportMonthly("pdf"))}
            disabled={exporting}
            className="flex items-center gap-1.5 h-10 px-3 rounded-lg bg-red-50 text-red-700 text-xs font-bold disabled:opacity-40 hover:bg-red-100 transition"
          >
            <FileText size={14} />
            PDF
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 px-1">Loading...</p>
      ) : viewMode === "DAILY" ? (
        <div className="rounded-2xl bg-white border border-slate-100 shadow-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="p-3">Employee</th>
                <th className="p-3">Date</th>
                <th className="p-3">Status</th>
                <th className="p-3">Shift Start</th>
                <th className="p-3">Manual</th>
                <th className="p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {rangeRows.map(({ employee, date, status, row, override }) => {
                const key = `${employee.id}::${date}`;
                return (
                  <tr key={key} className="border-b border-slate-50 last:border-0 align-top">
                    <td className="p-3 font-semibold text-slate-800">{employee.name}</td>
                    <td className="p-3 text-slate-500">{new Date(date).toLocaleDateString([], { month: "short", day: "numeric" })}</td>
                    <td className="p-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_DISPLAY[status].className}`}>
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
                    <td className="p-3 text-slate-500">
                      {row
                        ? new Date(row.shift_start_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) +
                          (row.attendance_type === "HALF_DAY_SECOND" ? " (2nd half)" : "")
                        : "—"}
                    </td>
                    <td className="p-3 text-slate-500">{override ? `✋ ${override.marked_by?.name || "—"}` : "—"}</td>
                    <td className="p-3">
                      {!row &&
                        (overrideFormKey === key ? (
                          <div className="flex flex-col gap-2 items-start">
                            <input
                              value={overrideReason}
                              onChange={(e) => setOverrideReason(e.target.value)}
                              placeholder="Reason (required)"
                              className="h-9 w-48 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs outline-none"
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
        <div className="rounded-2xl bg-white border border-slate-100 shadow-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="p-3">Employee</th>
                <th className="p-3">On Time</th>
                <th className="p-3">Late Coming (free)</th>
                <th className="p-3">Half Day</th>
                <th className="p-3">Absent</th>
              </tr>
            </thead>
            <tbody>
              {monthlyRows.map(({ employee, counts }) => (
                <tr key={employee.id} className="border-b border-slate-50 last:border-0">
                  <td className="p-3 font-semibold text-slate-800">{employee.name}</td>
                  <td className="p-3 text-emerald-700 font-semibold">{counts.ON_TIME}</td>
                  <td className="p-3 text-amber-700 font-semibold">{counts.LATE_COMING}</td>
                  <td className="p-3 text-orange-700 font-semibold">{counts.HALF_DAY}</td>
                  <td className="p-3 text-red-600 font-semibold">{counts.ABSENT}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
