"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import { isLeadTerminal } from "@/lib/isLeadTerminal";
import MarkEmployeeLeaveModal from "@/components/MarkEmployeeLeaveModal";

interface LeavePeriod {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string | null;
  reason: string | null;
  marked_by_employee_id: string;
  created_at: string;
  employee: { name: string } | null;
  marked_by: { name: string } | null;
}

// Point B (2026-08-23) — dedicated page rather than a tab bolted onto
// Admin Employees, matching the same call already made for Backup
// Status: this needs its own filterable list (date-range lookback,
// per-employee affected-lead-counts), not a roster-management concern.
// Also where Admin marks new leave (MarkEmployeeLeaveModal) — mark and
// review live on the same page.
//
// "Affected leads" is only computed for CURRENTLY ACTIVE rows (start_
// date <= today AND (end_date IS NULL OR end_date >= today)) — a past
// leave period's affected-count is meaningless in hindsight (those
// leads have long since moved on, one way or another), and showing a
// number there would just be confusing, not informative.
export default function AdminLeavePage() {

  const [leavePeriods, setLeavePeriods] = useState<LeavePeriod[]>([]);
  const [employees, setEmployees] = useState<{ id: string; name: string; is_active: boolean }[]>([]);
  const [affectedCountByEmployeeId, setAffectedCountByEmployeeId] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [monthFilter, setMonthFilter] = useState(""); // "" = all, else "YYYY-MM"
  const [markingReturnedId, setMarkingReturnedId] = useState<string | null>(null);

  useEffect(() => {
    loadLeavePeriods();
    loadEmployees();
  }, []);

  async function loadEmployees() {
    const { data, error } = await supabase
      .from("employees")
      .select("id, name, is_active")
      .order("name");

    if (error) {
      toast.error(error.message || "Could not load employees.");
      return;
    }
    if (data) setEmployees(data);
  }

  async function loadLeavePeriods() {
    setLoading(true);

    const { data, error } = await supabase
      .from("employee_leave_periods")
      .select(
        `
        id, employee_id, start_date, end_date, reason, marked_by_employee_id, created_at,
        employee:employees!employee_leave_periods_employee_id_fkey(name),
        marked_by:employees!employee_leave_periods_marked_by_employee_id_fkey(name)
        `
      )
      .order("start_date", { ascending: false });

    if (error) {
      toast.error(error.message || "Could not load leave periods.");
      setLoading(false);
      return;
    }

    const rows = (data || []) as unknown as LeavePeriod[];
    setLeavePeriods(rows);

    // Affected-lead-count — one batched query for every currently-
    // active employee_id, not one query per row.
    const today = new Date().toISOString().slice(0, 10);
    const activeEmployeeIds = Array.from(
      new Set(
        rows
          .filter((r) => r.start_date <= today && (!r.end_date || r.end_date >= today))
          .map((r) => r.employee_id)
      )
    );

    if (activeEmployeeIds.length > 0) {
      const { data: activeLeads, error: leadsError } = await supabase
        .from("leads")
        .select("current_owner_id, board_stage, status, lead_type")
        .in("current_owner_id", activeEmployeeIds);

      if (!leadsError && activeLeads) {
        const counts: Record<string, number> = {};
        for (const lead of activeLeads) {
          // Same "is this lead actually on the Follow-up inactivity
          // clock" test as calculateSLAStatus.ts / AdminLeadCard —
          // only these leads have a timer that leave-marking pauses.
          const isBeyondLeadsStage = lead.lead_type !== "DATA" && lead.board_stage !== "LEADS";
          if (isBeyondLeadsStage && !isLeadTerminal(lead.status, lead.board_stage)) {
            counts[lead.current_owner_id] = (counts[lead.current_owner_id] || 0) + 1;
          }
        }
        setAffectedCountByEmployeeId(counts);
      }
    } else {
      setAffectedCountByEmployeeId({});
    }

    setLoading(false);
  }

  // Piece 5 — the actual resolution to an open-ended leave sitting
  // unclosed: one tap sets end_date to today via end_employee_leave_
  // atomic, rather than Admin needing to remember a separate edit
  // flow. Only ever shown for open-ended rows (see the JSX below).
  async function handleMarkReturned(leaveId: string) {
    setMarkingReturnedId(leaveId);
    try {
      // p_end_date deliberately omitted -- the RPC's own default
      // (yesterday, not today) is what actually makes "returned
      // today" take effect immediately (2026-08-27 bug fix: end_date
      // is inclusive everywhere this table is read, so setting it to
      // today left the employee paused through the rest of today
      // too). One source of truth for that semantics, in the RPC.
      const { error } = await supabase.rpc("end_employee_leave_atomic", {
        p_leave_id: leaveId
      });

      if (error) {
        toast.error(error.message || "Could not mark this employee returned.");
        return;
      }

      toast.success("Marked returned today.");
      loadLeavePeriods();
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong.");
    } finally {
      setMarkingReturnedId(null);
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  const visibleLeavePeriods = useMemo(() => {
    if (!monthFilter) return leavePeriods;

    // A leave period is "in" the filtered month if its range overlaps
    // that month at all — not just if it started in that month, so a
    // long leave spanning multiple months shows up in each one.
    const monthStart = `${monthFilter}-01`;
    const monthEndDate = new Date(monthFilter + "-01");
    monthEndDate.setMonth(monthEndDate.getMonth() + 1);
    monthEndDate.setDate(0);
    const monthEnd = monthEndDate.toISOString().slice(0, 10);

    return leavePeriods.filter((r) => r.start_date <= monthEnd && (!r.end_date || r.end_date >= monthStart));
  }, [leavePeriods, monthFilter]);

  function formatRange(r: LeavePeriod): { label: string; isOpenEndedStale: boolean } {
    const startLabel = new Date(r.start_date).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

    if (!r.end_date) {
      // Clamped at 0 (2026-08-27 audit finding) — a future-dated
      // start_date (Admin pre-scheduling a leave that hasn't started
      // yet) would otherwise show a negative day count here. isActive
      // already correctly excludes it from "Currently on leave" and
      // the Mark Returned Today button, so this is purely a label fix
      // for the still-visible row, not a functional gap.
      const daysSinceStart = Math.max(0, Math.floor((Date.now() - new Date(r.start_date).getTime()) / (1000 * 60 * 60 * 24)));
      return {
        label: `${startLabel} — Open-ended (${daysSinceStart}d so far)`,
        // 14-day threshold matches Piece 5's planned nudge-notification
        // threshold — this UI flag is the passive counterpart to that
        // active notification, shown here regardless of whether Piece
        // 5 has fired yet.
        isOpenEndedStale: daysSinceStart >= 14
      };
    }

    const endLabel = new Date(r.end_date).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
    return { label: `${startLabel} — ${endLabel}`, isOpenEndedStale: false };
  }

  return (
    <div className="space-y-6 pb-10">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-[24px] bg-gradient-to-br from-teal-700 via-emerald-600 to-teal-500 text-white p-6"
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.2em] text-teal-100 uppercase mb-2">
              Employee Leave
            </p>
            <h1 className="text-xl font-bold">Leave / Holiday Tracking</h1>
            <p className="text-sm text-white/70 mt-1">
              While an employee is marked on leave, their Follow-up leads' inactivity timer is paused — no
              warning, no recycling — until leave ends.
            </p>
          </div>

          <button
            onClick={() => setModalOpen(true)}
            className="shrink-0 flex items-center gap-1.5 h-10 px-4 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-sm font-semibold transition"
          >
            🌴 Mark Employee On Leave
          </button>
        </div>
      </motion.div>

      <div className="flex items-center gap-2">
        <label className="text-xs font-semibold text-slate-500">Filter by month:</label>
        <input
          type="month"
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
          className="h-10 rounded-xl bg-white border border-slate-200 px-3 text-xs font-semibold text-slate-600 outline-none focus:ring-2 focus:ring-teal-200"
        />
        {monthFilter && (
          <button
            onClick={() => setMonthFilter("")}
            className="text-xs font-semibold text-teal-700 hover:underline"
          >
            Clear
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 px-1">Loading...</p>
      ) : visibleLeavePeriods.length === 0 ? (
        <p className="text-sm text-slate-400 px-1">
          {monthFilter ? "No leave periods overlap this month." : "No leave periods marked yet."}
        </p>
      ) : (
        <div className="space-y-3">
          {visibleLeavePeriods.map((r) => {
            const isActive = r.start_date <= today && (!r.end_date || r.end_date >= today);
            const { label, isOpenEndedStale } = formatRange(r);
            const affectedCount = affectedCountByEmployeeId[r.employee_id] || 0;

            return (
              <div key={r.id} className="rounded-2xl bg-white border border-slate-100 shadow-[0_2px_10px_rgba(15,23,42,0.05)] p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-slate-800">{r.employee?.name || "Unknown employee"}</p>
                      {isActive && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-50 text-teal-700">
                          🌴 Currently on leave
                        </span>
                      )}
                      {isOpenEndedStale && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                          ⚠️ Needs a return date
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{label}</p>
                    {r.reason && (
                      <p className="text-xs text-slate-500 mt-0.5">Reason: {r.reason}</p>
                    )}
                    <p className="text-[11px] text-slate-400 mt-1">
                      Marked by {r.marked_by?.name || "—"} on{" "}
                      {new Date(r.created_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>

                  {isActive && (
                    <div className="shrink-0 flex flex-col items-end gap-2">
                      <span className="text-xs font-semibold text-slate-500">
                        {affectedCount} lead{affectedCount === 1 ? "" : "s"} affected
                      </span>
                      {!r.end_date && (
                        <button
                          onClick={() => handleMarkReturned(r.id)}
                          disabled={markingReturnedId === r.id}
                          className="text-xs font-bold px-3 py-1.5 rounded-full bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-60 transition"
                        >
                          {markingReturnedId === r.id ? "Marking..." : "Mark Returned Today"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <MarkEmployeeLeaveModal
          employees={employees}
          onClose={() => setModalOpen(false)}
          onMarked={loadLeavePeriods}
        />
      )}
    </div>
  );
}
