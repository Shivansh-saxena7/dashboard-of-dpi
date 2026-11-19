"use client";
// Admin Home A2 (2026-11-19): Today so far + Team today, and the workload on demand. Read-only, bounded, no polling,
// no realtime channel. The only RPC is get_call_quality_summary (the same call the admin Call Quality overview makes,
// p_employee_id null, 7 days). Each card loads on its own; Refresh / the app coming back (after a minute) reloads.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { reportClientError } from "@/lib/reportClientError";
import { useWorkingCalendar } from "@/lib/useWorkingCalendar";
import { istDayKey } from "@/lib/callQuality";
import { istYmd } from "@/lib/noShiftAlert";
import {
  bandsFromSummary,
  teamMembers,
  teamStatus,
  todayWindows,
  workloadByOwner,
  type TeamAttendance,
  type TeamEmployee,
  type TeamMember,
  type WorkloadLead
} from "@/lib/adminHome";

export const TODAY_LIMITS = { attendance: 500, employees: 1000, leave: 5000 };
const FOCUS_REFRESH_MS = 60_000;

export interface TileCounts {
  calls: [number, number];
  results: [number, number];
  bookings: [number, number];
  onShift: [number, number];
}
export interface CardState<T> {
  data: T | null;
  error: boolean;
  loading: boolean;
}
const initial = <T,>(): CardState<T> => ({ data: null, error: false, loading: true });

// Count-only (HEAD) read of one table between two times.
async function countBetween(table: string, column: string, from: string, to: string, eqs: [string, string][]) {
  let q = supabase.from(table).select("id", { count: "exact", head: true });
  for (const [k, v] of eqs) q = q.eq(k, v);
  const { count, error } = await q.gte(column, from).lt(column, to).limit(1);
  if (error) throw error;
  return count ?? 0;
}

export function useAdminToday() {
  const calendar = useWorkingCalendar();
  const calRef = useRef(calendar);
  calRef.current = calendar;
  const [tiles, setTiles] = useState<CardState<TileCounts>>(initial);
  const [team, setTeam] = useState<CardState<{ members: TeamMember[]; estimated: boolean; bandsLoaded: boolean }>>(initial);
  const [workload, setWorkload] = useState<CardState<Map<string, { leads: number; overdue: number; untouched: number }>>>({ data: null, error: false, loading: false });
  const lastLoad = useRef(0);
  const teamIds = useRef<string[]>([]);

  const loadTiles = useCallback(async () => {
    setTiles((s) => ({ ...s, loading: true }));
    const now = Date.now();
    const w = todayWindows(now);
    const today = istYmd(now);
    const yesterday = istYmd(now - 86400e3);
    try {
      const both = (table: string, column: string, eqs: [string, string][]) =>
        Promise.all([countBetween(table, column, w.today.from, w.today.to, eqs), countBetween(table, column, w.yesterday.from, w.yesterday.to, eqs)]) as Promise<[number, number]>;
      const [calls, results, bookings, att] = await Promise.all([
        both("contact_click_log", "clicked_at", [["click_type", "CALL"]]),
        both("lead_activity_log", "created_at", [["activity_type", "STATUS_UPDATE"]]),
        both("leads", "board_stage_changed_at", [["board_stage", "BOOKING"]]),
        supabase
          .from("attendance")
          .select("employee_id, date, shift_start_at")
          .in("date", [today, yesterday])
          .not("shift_start_at", "is", null)
          .limit(TODAY_LIMITS.attendance)
      ]);
      if (att.error) throw att.error;
      const rows = (att.data || []) as { employee_id: string; date: string; shift_start_at: string }[];
      const onToday = new Set(rows.filter((r) => r.date === today).map((r) => r.employee_id)).size;
      const onYesterday = new Set(rows.filter((r) => r.date === yesterday && Date.parse(r.shift_start_at) <= now - 86400e3).map((r) => r.employee_id)).size;
      setTiles({ data: { calls, results, bookings, onShift: [onToday, onYesterday] }, error: false, loading: false });
    } catch (err) {
      reportClientError("admin-home:today", (err as { message?: string })?.message ?? err, "warning");
      setTiles({ data: null, error: true, loading: false });
    }
  }, []);

  const loadTeam = useCallback(async () => {
    setTeam((s) => ({ ...s, loading: true }));
    const now = Date.now();
    const today = istYmd(now);
    const [emp, att, leave, hrms, les, cq] = await Promise.all([
      supabase.from("employees").select("id, name, is_active, role, department").eq("is_active", true).limit(TODAY_LIMITS.employees),
      supabase.from("attendance").select("employee_id, shift_start_at, shift_end_at, attendance_type").eq("date", today).limit(TODAY_LIMITS.attendance),
      supabase.from("employee_leave_periods").select("employee_id, start_date, end_date").limit(TODAY_LIMITS.leave),
      supabase.from("hrms_settings").select("first_half_ontime_cutoff, second_half_ontime_cutoff").eq("id", 1).limit(1),
      supabase.from("lead_engine_settings").select("first_half_start_window_end").eq("id", 1).limit(1),
      supabase.rpc("get_call_quality_summary", { p_employee_id: null, p_from: istDayKey(6), p_to: istDayKey(0) })
    ]);
    const err = emp.error || att.error || leave.error || hrms.error || les.error;
    if (err) {
      reportClientError("admin-home:team", err.message, "warning");
      setTeam({ data: null, error: true, loading: false });
      return;
    }
    if (cq.error) reportClientError("admin-home:call-quality", cq.error.message, "info");
    const cutoffs = ((hrms.data || [])[0] as { first_half_ontime_cutoff: string; second_half_ontime_cutoff: string }) ?? { first_half_ontime_cutoff: "10:35:00", second_half_ontime_cutoff: "13:30:00" };
    const windowEnd = (((les.data || [])[0] as { first_half_start_window_end?: string }) ?? {}).first_half_start_window_end ?? "11:30:00";
    const members = teamStatus({
      employees: emp.data as TeamEmployee[],
      attendance: att.data as TeamAttendance[],
      leaveRows: leave.data as any[],
      cutoffs,
      firstWindowEnd: windowEnd,
      todayYmd: today,
      nowMs: now,
      cal: calRef.current,
      bands: cq.error ? undefined : bandsFromSummary(cq.data as any)
    });
    teamIds.current = teamMembers(emp.data as TeamEmployee[]).map((e) => e.id);
    setTeam({ data: { members, estimated: Boolean((cq.data as { estimated?: boolean } | null)?.estimated), bandsLoaded: !cq.error }, error: false, loading: false });
  }, []);

  // Heavy (every active LEAD lead of the team, about 2,000 rows): only when the admin asks, once, through fetchAllRows.
  const loadWorkload = useCallback(async () => {
    const ids = teamIds.current;
    if (ids.length === 0) return;
    setWorkload({ data: null, error: false, loading: true });
    const { data, error } = await fetchAllRows(
      () =>
        supabase
          .from("leads")
          .select(
            "current_owner_id, status, board_stage, sla_deadline, recycle_count, is_personal_lead, lead_history!inner(employee_id, is_active, call_count, outcome_at, assigned_at, first_call_at, first_whatsapp_at, last_activity_at, paused_until, pause_reason)"
          )
          .in("current_owner_id", ids)
          .eq("lead_type", "LEAD")
          .eq("lead_history.is_active", true)
          .order("id", { ascending: true }),
      { anomalyContext: { supabase, source: "admin-home:workload" } }
    );
    if (error) {
      reportClientError("admin-home:workload", error.message ?? error, "warning");
      setWorkload({ data: null, error: true, loading: false });
      return;
    }
    setWorkload({ data: workloadByOwner(data as WorkloadLead[], calRef.current), error: false, loading: false });
  }, []);

  const loadAll = useCallback(() => {
    lastLoad.current = Date.now();
    void loadTiles();
    void loadTeam();
    setWorkload({ data: null, error: false, loading: false }); // asked for again after a refresh
  }, [loadTiles, loadTeam]);

  useEffect(() => {
    loadAll();
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoad.current >= FOCUS_REFRESH_MS) loadAll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadAll]);

  // Leave / grace / day off need the working calendar; recompute the team once it arrives.
  const hadCalendar = useRef(false);
  useEffect(() => {
    if (calendar && !hadCalendar.current) {
      hadCalendar.current = true;
      void loadTeam();
    }
  }, [calendar, loadTeam]);

  return { tiles, team, workload, refresh: loadAll, loadWorkload, retry: { tiles: loadTiles, team: loadTeam, workload: loadWorkload } };
}
