"use client";
// Admin Performance Report (2026-11-20): data for app/admin/performance-report. Read-only.
//   * Flag: lead_engine_settings.admin_report_mode, one row. Missing column / error / anything but 'on' = page hidden.
//   * Report: one get_perf_report call per filter change (a newer request wins; stale answers are dropped).
//   * Drill-down: get_perf_report_leads only when a number is tapped, 200 rows per page.
//   * No polling, no realtime channel.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { reportClientError } from "@/lib/reportClientError";
import { filtersJson, type Filters, type PerfReport } from "@/lib/perfReport";

export const DRILL_PAGE = 200;

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
  const key = JSON.stringify([from, to, filters]);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: false }));
    const [f, t, flt] = JSON.parse(key) as [string, string, Filters];
    const { data, error } = await supabase.rpc("get_perf_report", { p_from: f, p_to: t, p_filters: filtersJson(flt) });
    if (my !== seq.current) return;
    if (error || !data) {
      reportClientError("perf-report:load", error?.message ?? "empty answer", "warning");
      setState({ data: null, loading: false, error: true });
      return;
    }
    setState({ data: data as PerfReport, loading: false, error: false });
  }, [key]);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  const drillSeq = useRef(0);
  const openDrill = useCallback(
    async (metric: string, title: string, extra: Partial<Filters> = {}, offset = 0) => {
      const my = ++drillSeq.current;
      const [f, t, flt] = JSON.parse(key) as [string, string, Filters];
      setDrill((d) => (offset && d ? { ...d, loading: true, error: false } : { metric, title, extra, rows: [], total: 0, loading: true, error: false }));
      const { data, error } = await supabase.rpc("get_perf_report_leads", {
        p_from: f, p_to: t, p_filters: filtersJson({ ...flt, ...extra }), p_metric: metric, p_limit: DRILL_PAGE, p_offset: offset
      });
      if (my !== drillSeq.current) return;
      if (error || !data) {
        reportClientError("perf-report:drill", error?.message ?? "empty answer", "warning");
        setDrill((d) => (d ? { ...d, loading: false, error: true } : d));
        return;
      }
      const res = data as { rows: Record<string, unknown>[]; total: number };
      setDrill((d) => ({ metric, title, extra, rows: offset && d ? [...d.rows, ...res.rows] : res.rows, total: res.total, loading: false, error: false }));
    },
    [key]
  );
  const closeDrill = useCallback(() => {
    drillSeq.current++;
    setDrill(null);
  }, []);

  return { ...state, retry: load, drill, openDrill, closeDrill };
}
