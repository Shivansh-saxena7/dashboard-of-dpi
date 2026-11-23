"use client";
// Admin Performance Report (2026-11-20, v2 2026-11-23): data for app/admin/performance-report. Read-only.
//   * Flag: lead_engine_settings.admin_report_mode, one row. Missing column / error / anything but 'on' = page hidden.
//   * Report: one get_perf_report_v2 call per filter change (falls back to v1 while the v2 SQL is not applied); a
//     newer request wins, stale answers are dropped; an invalid range (over 800 days) is never sent.
//   * Drill-down: get_perf_report_leads_v2 (or v1) only when a number is tapped, 200 rows per page; its CSV pages
//     through the same RPC. Filters always travel in the RPC body (POST), never in a URL.
//   * No polling, no realtime channel.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { reportClientError } from "@/lib/reportClientError";
import { filtersJson, rangeProblem, type Filters, type PerfReport } from "@/lib/perfReport";

export const DRILL_PAGE = 200;
export const DRILL_CSV_MAX = 20000;

export function useAdminReportMode(): "loading" | "on" | "off" {
  const [mode, setMode] = useState<"loading" | "on" | "off">("loading");
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase.from("lead_engine_settings").select("*").eq("id", 1).maybeSingle();
      if (!alive) return;
      if (error) reportClientError("perf-report:flag", error.message, "warning");
      const row = (data ?? null) as Record<string, unknown> | null;
      setMode(!error && row && row.admin_report_mode === "on" ? "on" : "off");
    })();
    return () => {
      alive = false;
    };
  }, []);
  return mode;
}

// v2 not applied yet -> PostgREST "function not found" (PGRST202) or Postgres 42883.
const missingFn = (e: { code?: string; message?: string } | null) => !!e && (e.code === "PGRST202" || e.code === "42883" || /could not find the function/i.test(e.message || ""));

export interface DrillState {
  metric: string;
  title: string;
  extra: Partial<Filters>;
  rows: Record<string, unknown>[];
  total: number;
  loading: boolean;
  error: boolean;
}

export function usePerfReport(from: string, to: string, filters: Filters, enabled: boolean) {
  const [state, setState] = useState<{ data: PerfReport | null; loading: boolean; error: boolean }>({ data: null, loading: true, error: false });
  const [drill, setDrill] = useState<DrillState | null>(null);
  const seq = useRef(0);
  const api = useRef<1 | 2>(2);
  const key = JSON.stringify([from, to, filters]);
  const invalid = rangeProblem(from, to);

  const load = useCallback(async () => {
    const [f, t, flt] = JSON.parse(key) as [string, string, Filters];
    if (rangeProblem(f, t)) return;
    const my = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: false }));
    const args = { p_from: f, p_to: t, p_filters: filtersJson(flt) };
    // Remember which one this request asked: two loads can be in flight (React dev runs effects twice).
    const usedV2 = api.current === 2;
    let res = await supabase.rpc(usedV2 ? "get_perf_report_v2" : "get_perf_report", args);
    if (usedV2 && missingFn(res.error)) {
      api.current = 1;
      res = await supabase.rpc("get_perf_report", args);
    }
    if (my !== seq.current) return;
    if (res.error || !res.data) {
      reportClientError("perf-report:load", res.error?.message ?? "empty answer", "warning");
      setState({ data: null, loading: false, error: true });
      return;
    }
    setState({ data: res.data as PerfReport, loading: false, error: false });
  }, [key]);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  const fetchDrillPage = useCallback(
    async (metric: string, extra: Partial<Filters>, offset: number) => {
      const [f, t, flt] = JSON.parse(key) as [string, string, Filters];
      const args = { p_from: f, p_to: t, p_filters: filtersJson({ ...flt, ...extra }), p_metric: metric, p_limit: DRILL_PAGE, p_offset: offset };
      const usedV2 = api.current === 2;
      let res = await supabase.rpc(usedV2 ? "get_perf_report_leads_v2" : "get_perf_report_leads", args);
      if (usedV2 && missingFn(res.error)) {
        api.current = 1;
        res = await supabase.rpc("get_perf_report_leads", args);
      }
      return res as { data: { rows: Record<string, unknown>[]; total: number } | null; error: { message: string } | null };
    },
    [key]
  );

  const drillSeq = useRef(0);
  const openDrill = useCallback(
    async (metric: string, title: string, extra: Partial<Filters> = {}, offset = 0) => {
      const my = ++drillSeq.current;
      setDrill((d) => (offset && d ? { ...d, loading: true, error: false } : { metric, title, extra, rows: [], total: 0, loading: true, error: false }));
      const { data, error } = await fetchDrillPage(metric, extra, offset);
      if (my !== drillSeq.current) return;
      if (error || !data) {
        reportClientError("perf-report:drill", error?.message ?? "empty answer", "warning");
        setDrill((d) => (d ? { ...d, loading: false, error: true } : d));
        return;
      }
      setDrill((d) => ({ metric, title, extra, rows: offset && d ? [...d.rows, ...data.rows] : data.rows, total: data.total, loading: false, error: false }));
    },
    [fetchDrillPage]
  );
  const closeDrill = useCallback(() => {
    drillSeq.current++;
    setDrill(null);
  }, []);

  // Every lead behind one number, page by page (200 each), for the drill-down CSV.
  const allDrillRows = useCallback(
    async (metric: string, extra: Partial<Filters>, onProgress?: (done: number, total: number) => void) => {
      const rows: Record<string, unknown>[] = [];
      let total = Infinity;
      for (let offset = 0; offset < total && offset < DRILL_CSV_MAX; offset += DRILL_PAGE) {
        const { data, error } = await fetchDrillPage(metric, extra, offset);
        if (error || !data) {
          reportClientError("perf-report:drill-csv", error?.message ?? "empty answer", "warning");
          throw new Error(error?.message ?? "empty answer");
        }
        total = data.total;
        rows.push(...data.rows);
        onProgress?.(rows.length, total);
        if (data.rows.length === 0) break;
      }
      return rows;
    },
    [fetchDrillPage]
  );

  return { ...state, invalid, retry: load, drill, openDrill, closeDrill, allDrillRows };
}
