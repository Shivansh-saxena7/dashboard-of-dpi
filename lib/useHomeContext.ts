"use client";
// Employee Home E6 (2026-11-19): the employee's own leave rows and Call Quality summary, for the leave strip and the
// Call Quality card. Read-only and bounded:
//   * employee_leave_periods: own rows only (RLS + .eq), recent or open, at most 20.
//   * get_call_quality_summary: the same RPC and 7-day window My Call Quality uses, for this employee only. When Call
//     Quality is hidden from employees or not there, the card is simply not shown.
// Loaded once, and again when the app comes back to the foreground (at most once a minute). No polling, no channel.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { istDayKey, isCallQualityHidden, isCallQualityMissing } from "@/lib/callQuality";
import type { LeavePeriodRow } from "@/lib/ownerLeave";
import { reportClientError } from "@/lib/reportClientError";

export const HOME_LEAVE_LIMIT = 20;
const FOCUS_REFRESH_MS = 60_000;

export function useHomeContext(employeeId: string | null | undefined) {
  const [leaveRows, setLeaveRows] = useState<LeavePeriodRow[] | null>(null);
  const [cqSummary, setCqSummary] = useState<any | null>(null);
  const lastLoad = useRef(0);

  const load = useCallback(async () => {
    if (!employeeId) return;
    lastLoad.current = Date.now();
    const since = istDayKey(30);
    const [leaveRes, cqRes] = await Promise.all([
      supabase
        .from("employee_leave_periods")
        .select("employee_id, start_date, end_date")
        .eq("employee_id", employeeId)
        .or(`end_date.is.null,end_date.gte.${since}`)
        .order("start_date", { ascending: true })
        .limit(HOME_LEAVE_LIMIT),
      supabase.rpc("get_call_quality_summary", { p_employee_id: employeeId, p_from: istDayKey(6), p_to: istDayKey(0) })
    ]);
    if (leaveRes.error) reportClientError("home:leave", leaveRes.error.message, "warning");
    else setLeaveRows((leaveRes.data || []) as LeavePeriodRow[]);
    if (cqRes.error) {
      if (!isCallQualityMissing(cqRes.error) && !isCallQualityHidden(cqRes.error)) reportClientError("home:call-quality", cqRes.error.message, "warning");
      setCqSummary(null);
    } else {
      setCqSummary(cqRes.data ?? null);
    }
  }, [employeeId]);

  useEffect(() => {
    load();
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoad.current >= FOCUS_REFRESH_MS) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  return { leaveRows, cqSummary };
}
