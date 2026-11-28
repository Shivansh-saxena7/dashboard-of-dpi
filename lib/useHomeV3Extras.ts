"use client";
// Home v3 extras (2026-11-29), both kept off the Home's critical path:
//   * useHomeLeave: the leave strip's own light read, the same select as lib/useHomeContext.ts but WITHOUT the heavy
//     call-quality RPC. Runs after the Home has painted, gives up after 5 s, and on any error the strip simply stays
//     hidden (it never blocks or breaks the Home).
//   * useCallQualityOnDemand: the same get_call_quality_summary RPC as the previous Home, but only when the employee
//     taps "Check my score" (never on load), so the Home adds no load-time call to it.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { istDayKey, isCallQualityHidden, isCallQualityMissing } from "@/lib/callQuality";
import type { LeavePeriodRow } from "@/lib/ownerLeave";
import { HOME_LEAVE_LIMIT } from "@/lib/useHomeContext";

export const LEAVE_TIMEOUT_MS = 5000;

export function useHomeLeave(employeeId: string | null | undefined, ready: boolean): LeavePeriodRow[] | null {
  const [rows, setRows] = useState<LeavePeriodRow[] | null>(null);
  useEffect(() => {
    if (!employeeId || !ready) return;
    let alive = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), LEAVE_TIMEOUT_MS);
    (async () => {
      try {
        const { data, error } = await supabase
          .from("employee_leave_periods")
          .select("employee_id, start_date, end_date")
          .eq("employee_id", employeeId)
          .or(`end_date.is.null,end_date.gte.${istDayKey(30)}`)
          .order("start_date", { ascending: true })
          .limit(HOME_LEAVE_LIMIT)
          .abortSignal(ctrl.signal);
        if (alive && !error) setRows((data || []) as LeavePeriodRow[]);
      } catch {
        // hidden on any failure
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      alive = false;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [employeeId, ready]);
  return rows;
}

export type CallQualityState = { status: "idle" | "loading" | "ok" | "hidden" | "error"; summary: any | null };

export function useCallQualityOnDemand(employeeId: string | null | undefined): CallQualityState & { check: () => void } {
  const [s, setS] = useState<CallQualityState>({ status: "idle", summary: null });
  const check = useCallback(async () => {
    if (!employeeId) return;
    setS({ status: "loading", summary: null });
    const { data, error } = await supabase.rpc("get_call_quality_summary", { p_employee_id: employeeId, p_from: istDayKey(6), p_to: istDayKey(0) });
    if (error) setS({ status: isCallQualityMissing(error) || isCallQualityHidden(error) ? "hidden" : "error", summary: null });
    else setS({ status: data ? "ok" : "hidden", summary: data ?? null });
  }, [employeeId]);
  return { ...s, check };
}
