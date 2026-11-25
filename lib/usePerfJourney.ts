"use client";
// Lead Journey tab: ONE call (get_perf_journey) per filter change while the tab is open, nothing while it is closed; a
// drill-down / Excel page is one get_perf_journey_rows call on tap. Filters go in the POST body, never in a URL. No
// polling, no realtime, no writes.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { reportClientError } from "@/lib/reportClientError";
import { filtersJson, rangeProblem, type Filters } from "@/lib/perfReport";
import { JOURNEY_EXCEL_MAX, JOURNEY_EXCEL_PAGE, JOURNEY_PAGE, type ExportRow, type JourneyPage, type JourneyReport, type JourneyView } from "@/lib/perfJourney";

const missingFn = (e: { code?: string; message?: string } | null) => !!e && (e.code === "PGRST202" || e.code === "42883" || /could not find the function/i.test(e.message || ""));

export interface JourneyDrill { view: JourneyView; employee: string | null; title: string; page: JourneyPage | null; loading: boolean; error: boolean }

export function usePerfJourney(from: string, to: string, filters: Filters, enabled: boolean) {
  const [state, setState] = useState<{ data: JourneyReport | null; loading: boolean; error: boolean }>({ data: null, loading: false, error: false });
  const [drill, setDrill] = useState<JourneyDrill | null>(null);
  const seq = useRef(0);
  const drillSeq = useRef(0);
  const key = JSON.stringify([from, to, filters]);

  const load = useCallback(async () => {
    const [f, t, flt] = JSON.parse(key) as [string, string, Filters];
    if (rangeProblem(f, t)) return;
    const my = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: false }));
    const { data, error } = await supabase.rpc("get_perf_journey", { p_from: f, p_to: t, p_filters: filtersJson(flt, 4) });
    if (my !== seq.current) return;
    if (error || !data) {
      reportClientError("perf-journey:load", error?.message ?? "empty answer", "warning");
      setState({ data: null, loading: false, error: true });
      return;
    }
    setState({ data: data as JourneyReport, loading: false, error: false });
  }, [key]);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  const fetchRows = useCallback(
    async (view: JourneyView, employee: string | null, offset: number, limit = JOURNEY_PAGE) => {
      const [f, t, flt] = JSON.parse(key) as [string, string, Filters];
      const res = await supabase.rpc("get_perf_journey_rows", { p_from: f, p_to: t, p_filters: filtersJson(flt, 4), p_view: view, p_employee: employee, p_limit: limit, p_offset: offset });
      return res as { data: JourneyPage | null; error: { message: string } | null };
    },
    [key]
  );

  const openDrill = useCallback(
    async (view: JourneyView, employee: string | null, title: string, more = false) => {
      const my = ++drillSeq.current;
      const offset = more ? drill?.page?.rows.length ?? 0 : 0;
      setDrill((d) => (more && d ? { ...d, loading: true, error: false } : { view, employee, title, page: null, loading: true, error: false }));
      const { data, error } = await fetchRows(view, employee, offset);
      if (my !== drillSeq.current) return;
      if (error || !data) {
        reportClientError("perf-journey:drill", error?.message ?? "empty answer", "warning");
        setDrill((d) => (d ? { ...d, loading: false, error: true } : d));
        return;
      }
      setDrill((d) => ({ view, employee, title, loading: false, error: false, page: more && d?.page ? { ...data, rows: [...d.page.rows, ...data.rows] } : data }));
    },
    [fetchRows, drill]
  );
  const closeDrill = useCallback(() => {
    drillSeq.current++;
    setDrill(null);
  }, []);

  // Every journey for the Excel file, 500 a call (at most 20,000). The export RPC adds the lead's name / mobile and the
  // positive dates; on an older database (function missing) it falls back to the journeys RPC (lead id only).
  const allRows = useCallback(
    async (onProgress?: (done: number, total: number) => void) => {
      const [f, t, flt] = JSON.parse(key) as [string, string, Filters];
      const rows: ExportRow[] = [];
      let total = Infinity;
      let withContacts = true;
      for (let offset = 0; offset < total && offset < JOURNEY_EXCEL_MAX; offset += JOURNEY_EXCEL_PAGE) {
        let res: { data: unknown; error: { message: string; code?: string } | null } | null = withContacts
          ? await supabase.rpc("get_perf_journey_export", { p_from: f, p_to: t, p_filters: filtersJson(flt, 4), p_limit: JOURNEY_EXCEL_PAGE, p_offset: offset })
          : null;
        if (!res || (offset === 0 && missingFn(res.error))) {
          withContacts = false;
          res = await fetchRows("all", null, offset, JOURNEY_EXCEL_PAGE);
        }
        if (!res) throw new Error("No answer. No file was made.");
        const data = res.data as { total: number; rows: ExportRow[] } | null;
        if (res.error || !data) {
          const why = res.error?.message ?? "empty answer";
          reportClientError("perf-journey:excel", why, "warning");
          throw new Error(`Stopped after ${rows.length.toLocaleString("en-IN")} of ${Number.isFinite(total) ? total.toLocaleString("en-IN") : "?"} leads (${why}). No file was made.`);
        }
        total = data.total;
        rows.push(...data.rows);
        onProgress?.(rows.length, total);
        if (!data.rows.length) break;
      }
      return { rows, total, withContacts };
    },
    [fetchRows, key]
  );

  return { ...state, invalid: rangeProblem(from, to), retry: load, drill, openDrill, closeDrill, allRows };
}
