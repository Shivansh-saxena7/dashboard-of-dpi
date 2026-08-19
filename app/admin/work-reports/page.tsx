"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import WorkReportView from "@/components/WorkReportView";
import { todayKey } from "@/lib/leaderboardWeek";

interface EmployeeOption {
  id: string;
  name: string;
}

// Admin's Work Reports page (Point 4, 2026-08-19 live-production
// review) — "kisi bhi employee ka, kisi bhi din ka" report, with full
// history (no cleanup/TTL on the underlying tables — see Step 1). No
// auth-check needed here — admin/layout.tsx already gates every
// /admin/* route on role === "admin" before children ever render,
// same as app/admin/leaderboard/page.tsx.
//
// Reuses the exact same WorkReportView + get_employee_work_report RPC
// the employee's own /report page uses (Golden Rule — no separate
// admin-flavored report logic) — this page only owns the Employee-
// selector/Date-picker state and passes whichever pair is currently
// selected. get_employee_work_report's own authorization already
// allows Admin to request anyone's report — this page's job is purely
// UI, the real gate lives in the RPC.
export default function AdminWorkReportsPage() {

  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [whatsappGroupLabel, setWhatsappGroupLabel] = useState<string | null>(null);

  useEffect(() => {
    loadEmployees();

    supabase
      .from("lead_engine_settings")
      .select("work_report_whatsapp_group_label")
      .eq("id", 1)
      .single()
      .then(({ data }) => setWhatsappGroupLabel(data?.work_report_whatsapp_group_label || null));
  }, []);

  async function loadEmployees() {
    setLoadingEmployees(true);

    // Sales-department employees only — Work Report metrics (calls,
    // visits, bookings) only ever exist for Sales activity, same scope
    // as the employee-facing /report tab (Sales-only there too).
    const { data } = await supabase
      .from("employees")
      .select("id, name")
      .eq("department", "sales")
      .order("name");

    if (data) {
      setEmployees(data);
      if (data.length > 0) setSelectedEmployeeId(data[0].id);
    }

    setLoadingEmployees(false);
  }

  const selectedEmployee = employees.find((e) => e.id === selectedEmployeeId);

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold text-slate-800 mb-1">Work Reports</h1>
      <p className="text-sm text-slate-500 mb-5">
        Kisi bhi employee ka, kisi bhi din ka work report — full history, kabhi delete nahi hota.
      </p>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-md p-4 mb-4 flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <label className="text-xs font-semibold text-slate-500 block mb-1">Employee</label>
          <select
            value={selectedEmployeeId}
            onChange={(e) => setSelectedEmployeeId(e.target.value)}
            disabled={loadingEmployees}
            className="w-full h-11 rounded-xl bg-slate-50 border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-amber-200"
          >
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>

        <div className="flex-1">
          <label className="text-xs font-semibold text-slate-500 block mb-1">Date</label>
          <input
            type="date"
            value={selectedDate}
            max={todayKey()}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-full h-11 rounded-xl bg-slate-50 border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-amber-200"
          />
        </div>
      </div>

      {selectedEmployee && (
        <WorkReportView
          employeeId={selectedEmployee.id}
          employeeName={selectedEmployee.name}
          date={selectedDate}
          whatsappGroupLabel={whatsappGroupLabel}
        />
      )}
    </div>
  );
}
