"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import EmployeeTabBar from "@/components/EmployeeTabBar";
import { calculateDailyHrmsStatus, DailyHrmsStatus } from "@/lib/calculateHrmsAttendanceStatus";
import { STATUS_DISPLAY, STATUS_DOT, dateRangeArray } from "@/lib/hrmsAttendanceDisplay";

interface ShareRow {
  id: string;
  date_from: string;
  date_to: string;
  shared_at: string;
  shared_by: { name: string } | null;
}

interface AttendanceRow {
  date: string;
  shift_start_at: string;
  attendance_type: "FULL_DAY" | "HALF_DAY_SECOND" | "HALF_DAY_FIRST" | null;
}

// Own top-level route, mirrors app/documents/page.tsx exactly (same
// inline auth-check block, no shared employee layout exists yet).
// Read-only by construction -- no override/action controls anywhere
// on this page, unlike the HR version at app/hr/attendance/page.tsx.
// Day-by-day status is recomputed live from the employee's own real
// attendance rows via the SAME calculateDailyHrmsStatus HR uses, not
// a frozen snapshot -- a share record only ever says "this range is
// visible to you," never "here's what the status was."
export default function MyAttendancePage() {
  const router = useRouter();

  const [employee, setEmployee] = useState<any>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [expandedShareId, setExpandedShareId] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<{ date: string; status: DailyHrmsStatus }[]>([]);
  const [expandedLoading, setExpandedLoading] = useState(false);

  async function loadShares(employeeId: string) {
    const { data } = await supabase
      .from("attendance_shares")
      .select("id, date_from, date_to, shared_at, shared_by:employees!attendance_shares_shared_by_employee_id_fkey(name)")
      .eq("employee_id", employeeId)
      .order("shared_at", { ascending: false });
    setShares((data || []) as unknown as ShareRow[]);
  }

  async function toggleShare(share: ShareRow) {
    if (expandedShareId === share.id) {
      setExpandedShareId(null);
      return;
    }

    setExpandedShareId(share.id);
    setExpandedLoading(true);
    try {
      const [{ data: settings }, { data: att }] = await Promise.all([
        supabase.from("hrms_settings").select("first_half_ontime_cutoff, second_half_ontime_cutoff").eq("id", 1).single(),
        supabase
          .from("attendance")
          .select("date, shift_start_at, attendance_type")
          .eq("employee_id", employee.id)
          .gte("date", share.date_from)
          .lte("date", share.date_to)
      ]);

      if (!settings) {
        setExpandedRows([]);
        return;
      }

      const attByDate = new Map<string, AttendanceRow>((att || []).map((a: AttendanceRow) => [a.date, a]));
      const rows = dateRangeArray(share.date_from, share.date_to).map((date) => ({
        date,
        status: calculateDailyHrmsStatus(attByDate.get(date) || null, settings)
      }));
      setExpandedRows(rows);
    } finally {
      setExpandedLoading(false);
    }
  }

  useEffect(() => {
    async function getLoggedInEmployee() {
      const {
        data: { user }
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      const { data, error } = await supabase.from("employees").select("*").eq("auth_user_id", user.id).single();

      if (error || !data) {
        console.error("Employee not found");
        return;
      }

      if (!data.is_active) {
        await supabase.auth.signOut();
        router.replace("/login");
        return;
      }

      if (data.role === "admin") {
        router.replace("/admin");
        return;
      }

      setEmployee(data);
      setAuthChecked(true);

      await loadShares(data.id);
      setLoading(false);
    }

    getLoggedInEmployee();
  }, []);

  if (!authChecked) {
    return <div className="min-h-screen bg-white" />;
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-white via-blue-50 to-blue-100">
      <Header />
      <EmployeeTabBar role={employee?.role} department={employee?.department} />

      <div className="px-4 mt-4 space-y-3 pb-6">
        <div className="rounded-2xl bg-white border border-slate-100 shadow-md p-4">
          <p className="text-sm font-bold text-slate-800">My Attendance</p>
          <p className="text-xs text-slate-500 mt-0.5">
            HR shares a date range with you here when needed — view only.
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-slate-400 px-1">Loading...</p>
        ) : shares.length === 0 ? (
          <p className="text-sm text-slate-400 px-1">Nothing shared with you yet.</p>
        ) : (
          shares.map((share) => (
            <div
              key={share.id}
              className="rounded-2xl bg-white border border-slate-100 shadow-[0_2px_10px_rgba(15,23,42,0.05)] overflow-hidden"
            >
              <button onClick={() => toggleShare(share)} className="w-full flex items-center justify-between gap-3 p-4 text-left">
                <div>
                  <p className="text-sm font-bold text-slate-800">
                    {share.date_from === share.date_to ? share.date_from : `${share.date_from} to ${share.date_to}`}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Shared by {share.shared_by?.name || "HR"} on{" "}
                    {new Date(share.shared_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                </div>
                <span className="text-xs font-bold px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 shrink-0">
                  {expandedShareId === share.id ? "Hide" : "View"}
                </span>
              </button>

              {expandedShareId === share.id && (
                <div className="border-t border-slate-100 px-4 py-3 space-y-1.5">
                  {expandedLoading ? (
                    <p className="text-xs text-slate-400">Loading...</p>
                  ) : (
                    expandedRows.map((row) => (
                      <div key={row.date} className="flex items-center justify-between text-xs">
                        <span className="text-slate-600">
                          {new Date(row.date).toLocaleDateString([], { month: "short", day: "numeric" })}
                        </span>
                        <span className={`inline-flex items-center gap-1.5 font-bold px-2.5 py-1 rounded-full ${STATUS_DISPLAY[row.status].className}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[row.status]}`} />
                          {STATUS_DISPLAY[row.status].label}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <Footer />
    </main>
  );
}
