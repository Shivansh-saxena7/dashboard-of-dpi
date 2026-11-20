"use client";
// Admin Home A4 (2026-11-20): Visits and bookings + System controls. Read-only, bounded, no polling, no channel.
//   * Visits: count-only (HEAD) on site_visits per event_type (VISIT / REVISIT / BOOKED), every event like the
//     Coordinator page's Summary (pending + verified + denied), today vs yesterday at this time.
//   * Bookings: leads moved to BOOKING (board_stage_changed_at), the same source as the "Today so far" Bookings tile;
//     today and this month so far, each vs 24 h ago.
//   * System controls: one lead_engine_settings row (id 1), display only.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { reportClientError } from "@/lib/reportClientError";
import { controlStates, monthWindows, todayWindows, type ControlRow } from "@/lib/adminHome";

const FOCUS_REFRESH_MS = 60_000;
export const VISIT_TYPES = ["VISIT", "REVISIT", "BOOKED"] as const;

export interface SalesData {
  visits: Record<(typeof VISIT_TYPES)[number], [number, number]>;
  bookingsToday: [number, number];
  bookingsMonth: [number, number];
}
interface Card<T> {
  data: T | null;
  error: boolean;
  loading: boolean;
}

async function headCount(table: string, column: string, from: string, to: string, eqs: [string, string][]) {
  if (from >= to) return 0;
  let q = supabase.from(table).select("id", { count: "exact", head: true });
  for (const [k, v] of eqs) q = q.eq(k, v);
  const { count, error } = await q.gte(column, from).lt(column, to).limit(1);
  if (error) throw error;
  return count ?? 0;
}

export function useAdminSales() {
  const [sales, setSales] = useState<Card<SalesData>>({ data: null, error: false, loading: true });
  const [controls, setControls] = useState<Card<ControlRow[]>>({ data: null, error: false, loading: true });
  const lastLoad = useRef(0);

  const loadSales = useCallback(async () => {
    setSales((s) => ({ ...s, loading: true }));
    const now = Date.now();
    const w = todayWindows(now);
    const m = monthWindows(now);
    const pair = (table: string, column: string, a: { from: string; to: string }, b: { from: string; to: string }, eqs: [string, string][]) =>
      Promise.all([headCount(table, column, a.from, a.to, eqs), headCount(table, column, b.from, b.to, eqs)]) as Promise<[number, number]>;
    try {
      const [visit, revisit, booked, bookingsToday, bookingsMonth] = await Promise.all([
        ...VISIT_TYPES.map((t) => pair("site_visits", "created_at", w.today, w.yesterday, [["event_type", t]])),
        pair("leads", "board_stage_changed_at", w.today, w.yesterday, [["board_stage", "BOOKING"]]),
        pair("leads", "board_stage_changed_at", m.now, m.yesterday, [["board_stage", "BOOKING"]])
      ]);
      setSales({ data: { visits: { VISIT: visit, REVISIT: revisit, BOOKED: booked }, bookingsToday, bookingsMonth }, error: false, loading: false });
    } catch (e) {
      reportClientError("admin-home:sales", e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e), "warning");
      setSales({ data: null, error: true, loading: false });
    }
  }, []);

  const loadControls = useCallback(async () => {
    setControls((s) => ({ ...s, loading: true }));
    const { data, error } = await supabase.from("lead_engine_settings").select("*").eq("id", 1).maybeSingle();
    if (error || !data) {
      reportClientError("admin-home:controls", error?.message ?? "lead_engine_settings row missing", "warning");
      setControls({ data: null, error: true, loading: false });
      return;
    }
    setControls({ data: controlStates(data as Record<string, unknown>), error: false, loading: false });
  }, []);

  const refresh = useCallback(() => {
    lastLoad.current = Date.now();
    void loadSales();
    void loadControls();
  }, [loadSales, loadControls]);

  useEffect(() => {
    refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoad.current >= FOCUS_REFRESH_MS) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  return { sales, controls, refresh, retry: { sales: loadSales, controls: loadControls } };
}
