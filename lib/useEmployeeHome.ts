"use client";
// Employee Home, Phase 1 (2026-11-18): the data behind the new Home. Read-only.
//   * My leads: the same rows /leads loads (current owner, LEAD, the employee's active assignment), only the columns the
//     counts need, through fetchAllRows (no 1000-row ceiling). Counted by lib/employeeHome.ts, the rules /leads uses.
//   * Today: get_employee_work_report for today (IST), the same function /report shows.
//   * Refresh: one realtime channel (leads + lead_history of this employee, as /leads listens) and a refetch when the
//     app comes back to the foreground (at most once a minute). No interval polling.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { istDateYmd } from "@/lib/ownerLeave";
import { useWorkingCalendar } from "@/lib/useWorkingCalendar";
import { myLeadCounts, type HomeLead, type MyLeadCounts } from "@/lib/employeeHome";

export interface HomeToday {
  calls: number;
  connected: number;
  results_saved: number;
  followUps: number;
  visits: number;
}

export interface EmployeeHomeData {
  counts: MyLeadCounts | null;
  today: HomeToday | null;
  leadsError: boolean;
  todayError: boolean;
  loading: boolean;
  reload: () => void;
}

const HOME_LEAD_COLUMNS = `
  id,
  status,
  board_stage,
  sla_deadline,
  recycle_count,
  is_personal_lead,
  lead_history!inner (
    call_count,
    outcome_at,
    assigned_at,
    first_call_at,
    first_whatsapp_at,
    last_activity_at,
    paused_until,
    pause_reason
  )
`;

const FOCUS_REFRESH_MS = 60_000;
const REALTIME_DEBOUNCE_MS = 1500;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function useEmployeeHome(employeeId: string | null | undefined): EmployeeHomeData {
  const calendar = useWorkingCalendar();
  const [leads, setLeads] = useState<HomeLead[] | null>(null);
  const [today, setToday] = useState<HomeToday | null>(null);
  const [leadsError, setLeadsError] = useState(false);
  const [todayError, setTodayError] = useState(false);
  const [loading, setLoading] = useState(true);
  const lastLoad = useRef(0);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!employeeId) return;
    lastLoad.current = Date.now();
    const [leadsRes, reportRes] = await Promise.all([
      fetchAllRows(() =>
        supabase
          .from("leads")
          .select(HOME_LEAD_COLUMNS)
          .eq("current_owner_id", employeeId)
          .eq("lead_type", "LEAD")
          .eq("lead_history.employee_id", employeeId)
          .eq("lead_history.is_active", true)
          .order("id", { ascending: true })
      ),
      supabase.rpc("get_employee_work_report", { p_employee_id: employeeId, p_date: istDateYmd() })
    ]);
    if (!alive.current) return;
    if (leadsRes.error) {
      setLeadsError(true);
    } else {
      setLeadsError(false);
      setLeads((leadsRes.data || []) as HomeLead[]);
    }
    const report = reportRes.data as Record<string, unknown> | null;
    if (reportRes.error || !report || typeof report !== "object" || Array.isArray(report)) {
      setTodayError(true);
    } else {
      setTodayError(false);
      setToday({
        calls: num(report.calls),
        connected: num(report.connected),
        results_saved: num(report.results_saved),
        followUps: num(report.followUps),
        visits: num(report.visits)
      });
    }
    setLoading(false);
  }, [employeeId]);

  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  // One channel, same filters as /leads. A burst of changes (a save writes leads + lead_history) is one reload.
  useEffect(() => {
    if (!employeeId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const topic = `employee-home-${employeeId}`;
    const existing = supabase.getChannels().find((ch) => ch.topic === `realtime:${topic}`);
    if (existing) supabase.removeChannel(existing);
    const later = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => load(), REALTIME_DEBOUNCE_MS);
    };
    const channel = supabase
      .channel(topic)
      .on("postgres_changes", { event: "*", schema: "public", table: "leads", filter: `current_owner_id=eq.${employeeId}` }, later)
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_history", filter: `employee_id=eq.${employeeId}` }, later)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [employeeId, load]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoad.current >= FOCUS_REFRESH_MS) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const counts = useMemo(() => (leads ? myLeadCounts(leads, calendar) : null), [leads, calendar]);

  return { counts, today, leadsError, todayError, loading, reload: load };
}
