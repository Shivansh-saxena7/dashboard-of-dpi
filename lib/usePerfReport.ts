"use client";
// Admin Performance Report (2026-11-20, v2 2026-11-23, v3 simple view 2026-11-23): data for app/admin/performance-report.
//   * Flags: lead_engine_settings.admin_report_mode (the page) and admin_report_reassign_mode (give leads from the
//     report), one row. Missing column / error / anything but 'on' = off.
//   * Report: one get_perf_report_v3 call per filter change, falling back to v2 and then v1 while the newer SQL is not
//     applied; a newer request wins, stale answers are dropped; an invalid range (over 800 days) is never sent.
//   * Drill-down: get_perf_report_leads_v3 (or v2 / v1) only when a number is tapped, 200 rows per page; its CSV pages
//     through the same RPC. Journey: get_lead_journey for one lead, on tap. Filters travel in the RPC body (POST),
//     never in a URL.
//   * No polling, no realtime channel. Read-only (the give / give back calls live in lib/usePerfReassign.ts).
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { reportClientError } from "@/lib/reportClientError";
import { filtersJson, rangeProblem, type Filters, type PerfReport } from "@/lib/perfReport";

export const DRILL_PAGE = 200;
export const DRILL_CSV_MAX = 20000;
// v4 (2026-11-25, definitions v2): every result counted on the date it happened, for the person who had the lead then.
type Api = 1 | 2 | 3 | 4;
const REPORT_RPC: Record<Api, string> = { 4: "get_perf_report_v4", 3: "get_perf_report_v3", 2: "get_perf_report_v2", 1: "get_perf_report" };
const LEADS_RPC: Record<Api, string> = { 4: "get_perf_report_leads_v4", 3: "get_perf_report_leads_v3", 2: "get_perf_report_leads_v2", 1: "get_perf_report_leads" };

export interface ReportFlags { mode: "loading" | "on" | "off"; reassign: boolean }
export function useAdminReportFlags(): ReportFlags {
  const [flags, setFlags] = useState<ReportFlags>({ mode: "loading", reassign: false });
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase.from("lead_engine_settings").select("*").eq("id", 1).maybeSingle();
      if (!alive) return;
      if (error) reportClientError("perf-report:flag", error.message, "warning");
      const row = (data ?? null) as Record<string, unknown> | null;
      const mode = !error && row && row.admin_report_mode === "on" ? "on" : "off";
      setFlags({ mode, reassign: mode === "on" && !!row && row.admin_report_reassign_mode === "on" });
    })();
    return () => {
      alive = false;
    };
  }, []);
  return flags;
}
export const useAdminReportMode = () => useAdminReportFlags().mode;

// Newer SQL not applied yet -> PostgREST "function not found" (PGRST202) or Postgres 42883.
const missingFn = (e: { code?: string; message?: string } | null) => !!e && (e.code === "PGRST202" || e.code === "42883" || /could not find the function/i.test(e.message || ""));

// Call the newest report RPC this database has, stepping down on "function not found". The step-down is decided per
// request (two loads can be in flight: React dev runs effects twice), then remembered for the next calls.
async function callApi(names: Record<Api, string>, api: { current: Api }, args: (v: Api) => Record<string, unknown>) {
  let v: Api = api.current;
  let res = await supabase.rpc(names[v], args(v));
  while (v > 1 && missingFn(res.error)) {
    v = (v - 1) as Api;
    if (api.current > v) api.current = v;
    res = await supabase.rpc(names[v], args(v));
  }
  return res;
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
  const api = useRef<Api>(4);
  const key = JSON.stringify([from, to, filters]);
  const invalid = rangeProblem(from, to);

  const load = useCallback(async () => {
    const [f, t, flt] = JSON.parse(key) as [string, string, Filters];
    if (rangeProblem(f, t)) return;
    const my = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: false }));
    const res = await callApi(REPORT_RPC, api, (v) => ({ p_from: f, p_to: t, p_filters: filtersJson(flt, v) }));
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
      const res = await callApi(LEADS_RPC, api, (v) => ({ p_from: f, p_to: t, p_filters: filtersJson({ ...flt, ...extra }, v), p_metric: metric, p_limit: DRILL_PAGE, p_offset: offset }));
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

  // Every lead behind one number, page by page (200 each), for the drill-down CSV and "Select all".
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

// One lead's journey: every assignment with how it came and what happened. Needs the v3 SQL.
export interface JourneyStint {
  stint_id: string; employee_id: string; employee_name: string | null; assigned_at: string; ended_at: string | null; active: boolean; origin: string;
  followup: boolean; visit: boolean; converted: boolean; connected: boolean; result: string | null;
}
export async function loadJourney(leadId: string): Promise<{ stints: JourneyStint[] } | { error: string }> {
  const { data, error } = await supabase.rpc("get_lead_journey", { p_lead_id: leadId });
  if (error || !data) {
    reportClientError("perf-report:journey", error?.message ?? "empty answer", "warning");
    return { error: missingFn(error) ? "The journey needs the latest database update." : "Couldn't load the journey." };
  }
  return { stints: (data as { stints?: JourneyStint[] }).stints ?? [] };
}
