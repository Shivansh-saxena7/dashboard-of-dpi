"use client";
// Admin Home A1 (2026-11-19): the data behind the new Admin Home. Read-only, every read bounded, no RPC (the heartbeat
// check function writes anomalies, so the table is read instead), no polling, no realtime channel (the layout's alert
// channel stays the only one). Each card loads on its own: one slow or failing card never holds the others.
// Reloads: Refresh, or the app coming back to the foreground after at least a minute.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { reportClientError } from "@/lib/reportClientError";
import { useWorkingCalendar } from "@/lib/useWorkingCalendar";
import { addDaysYmd, buildNoShiftInputs, employeesWithoutShift, istYmd } from "@/lib/noShiftAlert";
import { errorsToday, heartbeatStatus, backupStatus, istDayStartIso, type BackupRow, type HeartbeatRow } from "@/lib/adminHome";

export const LIMITS = { heartbeats: 50, anomalies: 1000, approvals: 100, employees: 1000, leave: 5000, attendance: 10000, joins: 1000 };
const FOCUS_REFRESH_MS = 60_000;

export interface CardState<T> {
  data: T | null;
  error: boolean;
  loading: boolean;
}
const initial = <T,>(): CardState<T> => ({ data: null, error: false, loading: true });

export function useAdminHome() {
  const calendar = useWorkingCalendar();
  const [system, setSystem] = useState<CardState<{ heartbeats: ReturnType<typeof heartbeatStatus>; backup: ReturnType<typeof backupStatus> }>>(initial);
  const [errors, setErrors] = useState<CardState<ReturnType<typeof errorsToday>>>(initial);
  const [approvals, setApprovals] = useState<CardState<{ transfers: number; employeeRequests: number }>>(initial);
  const [noShift, setNoShift] = useState<CardState<number>>(initial);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const lastLoad = useRef(0);
  const calRef = useRef(calendar);
  calRef.current = calendar;

  const loadSystem = useCallback(async () => {
    setSystem((s) => ({ ...s, loading: true }));
    const now = Date.now();
    const [hb, bk] = await Promise.all([
      supabase.from("cron_heartbeats").select("function_name, max_silence_minutes, last_succeeded_at").limit(LIMITS.heartbeats),
      supabase.from("backup_run_log").select("run_at, status").order("run_at", { ascending: false }).limit(1)
    ]);
    if (hb.error || bk.error) {
      reportClientError("admin-home:system", (hb.error || bk.error)?.message ?? "read failed", "warning");
      setSystem({ data: null, error: true, loading: false });
      return;
    }
    setSystem({
      data: { heartbeats: heartbeatStatus(hb.data as HeartbeatRow[], now), backup: backupStatus(((bk.data || [])[0] as BackupRow) ?? null, now) },
      error: false,
      loading: false
    });
  }, []);

  const loadErrors = useCallback(async () => {
    setErrors((s) => ({ ...s, loading: true }));
    // Today's open problems, as System Health lists them (not reviewed).
    const { data, error } = await supabase
      .from("system_anomaly_log")
      .select("source, severity")
      .eq("reviewed", false)
      .gte("last_seen_at", istDayStartIso(Date.now()))
      .limit(LIMITS.anomalies);
    if (error) {
      reportClientError("admin-home:errors", error.message, "warning");
      setErrors({ data: null, error: true, loading: false });
      return;
    }
    setErrors({ data: errorsToday(data as { source: string; severity: string }[]), error: false, loading: false });
  }, []);

  const loadApprovals = useCallback(async () => {
    setApprovals((s) => ({ ...s, loading: true }));
    const [t, e] = await Promise.all([
      supabase.from("lead_transfer_requests").select("id").eq("status", "PENDING").limit(LIMITS.approvals),
      supabase.from("employee_creation_requests").select("id").eq("status", "PENDING").limit(LIMITS.approvals)
    ]);
    if (t.error || e.error) {
      reportClientError("admin-home:approvals", (t.error || e.error)?.message ?? "read failed", "warning");
      setApprovals({ data: null, error: true, loading: false });
      return;
    }
    setApprovals({ data: { transfers: (t.data || []).length, employeeRequests: (e.data || []).length }, error: false, loading: false });
  }, []);

  // The daily no-shift rule (lib/noShiftAlert.ts): field employees with no shift on their last 3 working, non-leave days.
  const loadNoShift = useCallback(async () => {
    const cal = calRef.current;
    if (!cal) return; // waits for the working calendar (the rule needs weekly off + holidays)
    setNoShift((s) => ({ ...s, loading: true }));
    const today = istYmd(Date.now());
    const [emp, leave, att, join] = await Promise.all([
      supabase.from("employees").select("id, name, is_active, role, department, created_at").eq("is_active", true).limit(LIMITS.employees),
      supabase.from("employee_leave_periods").select("employee_id, start_date, end_date").limit(LIMITS.leave),
      supabase.from("attendance").select("employee_id, date").gte("date", addDaysYmd(today, -45)).not("shift_start_at", "is", null).limit(LIMITS.attendance),
      supabase.from("employee_payroll_details").select("employee_id, date_of_joining").limit(LIMITS.joins)
    ]);
    const err = emp.error || leave.error || att.error || join.error;
    if (err) {
      reportClientError("admin-home:no-shift", err.message, "warning");
      setNoShift({ data: null, error: true, loading: false });
      return;
    }
    const { employees, shiftDays } = buildNoShiftInputs(emp.data as any[], join.data as any[], att.data as any[]);
    const flagged = employeesWithoutShift({ employees, leaveRows: leave.data as any[], shiftDays, todayYmd: today, cal });
    setNoShift({ data: flagged.length, error: false, loading: false });
  }, []);

  const loadAll = useCallback(() => {
    lastLoad.current = Date.now();
    setUpdatedAt(Date.now());
    void loadSystem();
    void loadErrors();
    void loadApprovals();
    void loadNoShift();
  }, [loadSystem, loadErrors, loadApprovals, loadNoShift]);

  useEffect(() => {
    loadAll();
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoad.current >= FOCUS_REFRESH_MS) loadAll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadAll]);

  // The calendar arrives a moment after the first render: then the no-shift card can run.
  useEffect(() => {
    if (calendar) {
      void loadNoShift();
      return;
    }
    // No working calendar after 4 s: say so on the card instead of loading for ever.
    const t = setTimeout(() => {
      if (!calRef.current) setNoShift({ data: null, error: true, loading: false });
    }, 4000);
    return () => clearTimeout(t);
  }, [calendar, loadNoShift]);

  return { system, errors, approvals, noShift, updatedAt, refresh: loadAll, retry: { system: loadSystem, errors: loadErrors, approvals: loadApprovals, noShift: loadNoShift } };
}
