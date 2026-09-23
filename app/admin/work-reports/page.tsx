"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import WorkReportView from "@/components/WorkReportView";
import { todayKey } from "@/lib/leaderboardWeek";

interface EmployeeOption {
  id: string;
  name: string;
}

interface StuckLeadEntry {
  leadName: string;
  mobile: string | null;
  callCount: number;
  daysSinceLastAttempt: number;
}

interface StuckOverviewRow {
  employeeId: string;
  employeeName: string;
  stuckCount: number;
  stuckLeads: StuckLeadEntry[];
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

  // Stuck Leads Overview (2026-09-21) — the "Low-Effort Alert" /
  // employee-wise-pattern view, doubling as both asks per the approved
  // plan rather than two separate builds. get_stuck_leads_overview
  // only returns employees with at least one stuck lead (an alert
  // surface, not a full roster padded with zeros).
  const [stuckOverview, setStuckOverview] = useState<StuckOverviewRow[]>([]);
  const [loadingStuckOverview, setLoadingStuckOverview] = useState(true);
  const [expandedStuckEmployeeId, setExpandedStuckEmployeeId] = useState<string | null>(null);

  useEffect(() => {
    loadEmployees();
    loadStuckOverview();

    supabase
      .from("lead_engine_settings")
      .select("work_report_whatsapp_group_label")
      .eq("id", 1)
      .single()
      .then(({ data }) => setWhatsappGroupLabel(data?.work_report_whatsapp_group_label || null));
  }, []);

  async function loadStuckOverview() {
    setLoadingStuckOverview(true);
    const { data, error } = await supabase.rpc("get_stuck_leads_overview");
    if (!error && data) {
      setStuckOverview(data as StuckOverviewRow[]);
    }
    setLoadingStuckOverview(false);
  }

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

      <div className="bg-white rounded-2xl border border-red-100 shadow-md p-4 mb-4">
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className="text-sm font-bold text-slate-800">⚠️ Not Connected, No Follow-up — Company-Wide</p>
          <div className="flex items-center gap-2 shrink-0">
            {stuckOverview.length > 0 && (
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-red-50 text-red-600 border border-red-200">
                {stuckOverview.reduce((sum, r) => sum + r.stuckCount, 0)} total
              </span>
            )}
            {/* Manual refresh (2026-09-21) -- this section is its own
                separate state (get_stuck_leads_overview, company-wide)
                from the per-employee WorkReportView below, which now
                auto-updates via realtime. An unfiltered lead_history
                subscription covering every employee just to keep this
                one panel live would be wasteful on a busy table --
                same manual-refresh precedent already used on this
                app's other company-wide oversight pages (System
                Health, Backup Status), reused here rather than a new
                pattern. */}
            <button
              onClick={loadStuckOverview}
              disabled={loadingStuckOverview}
              className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-50"
            >
              <RefreshCw size={12} className={loadingStuckOverview ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>
        {/* 2026-09-23 -- stuck_leads narrowed to status='NOT_CONNECTED'
            specifically (was any status with call_count=1), so this
            now names that one status accurately, same wording as
            WorkReportView's own tile. Live right now regardless of
            the date picker below, since it's a current-state
            snapshot, not a day-bound count. */}
        <p className="text-xs text-slate-400 mb-3">
          Leads each employee marked "Not Connected" on their one call, with no follow-up in 3+ days — live right now, not tied to the date picker below.
        </p>

        {loadingStuckOverview ? (
          <p className="text-sm text-slate-400">Loading...</p>
        ) : stuckOverview.length === 0 ? (
          <p className="text-sm text-slate-400">None right now — every lead has had more than one attempt, or was called within the last 3 days.</p>
        ) : (
          <div className="space-y-2">
            {stuckOverview.map((row) => {
              const isExpanded = expandedStuckEmployeeId === row.employeeId;
              return (
                <div key={row.employeeId} className="rounded-xl border border-slate-100 overflow-hidden">
                  <button
                    onClick={() => setExpandedStuckEmployeeId(isExpanded ? null : row.employeeId)}
                    className={`w-full flex items-center justify-between gap-2 p-3 text-left transition ${
                      isExpanded ? "bg-red-50/60" : "bg-slate-50 hover:bg-slate-100"
                    }`}
                  >
                    <span className="text-sm font-semibold text-slate-700">{row.employeeName}</span>
                    <span className="text-sm font-bold text-red-600 shrink-0">{row.stuckCount}</span>
                  </button>
                  {isExpanded && (
                    <div className="p-3 space-y-2 bg-white">
                      {row.stuckLeads.map((entry, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between text-sm border-b border-slate-50 last:border-0 pb-2 last:pb-0"
                        >
                          <div className="min-w-0">
                            <p className="text-slate-700 font-medium truncate">{entry.leadName}</p>
                            {entry.mobile && <p className="text-xs text-slate-400">{entry.mobile}</p>}
                          </div>
                          <span className="text-red-600 text-xs font-semibold shrink-0 ml-2">
                            {entry.daysSinceLastAttempt}d ago
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

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
