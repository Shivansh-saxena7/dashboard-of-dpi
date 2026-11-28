"use client";
// Admin Home A3 (2026-11-19): Lead engine today + positive-history junk. Read-only, bounded, no polling, no channel.
//   * Recycled today: count-only (HEAD) on lead_history (SYSTEM + recycle_reason), today vs yesterday at this time.
//   * Guard / hold events (2026-11-28): get_admin_guard_event_counts RPC, per (source, action) counts for the two windows
//     (lead_guard_events itself has no client grant; the old direct read failed with 42501 for every admin).
//   * Restore protections (2026-11-29): get_admin_restore_protection_counts RPC, open now / 24 h ago + earliest end
//     (lead_restore_log itself has no client grant; the old direct read failed with 42501 for every admin).
//   * Positive-history junk: get_positive_junk_leads() returns the whole list (it scans every Junk lead), so it never
//     runs on load or Refresh: only on "Check", once; the count (the page's "All") is remembered for the tab, 30 min.
//   * Junk today (A4): no junk timestamp exists, so count-only on the viewer's own LEAD_JUNKED notifications (one per
//     junked lead per active admin, sent by mark_lead_junk_atomic) and on the admin_junk guard count; sweep = the rest.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { reportClientError } from "@/lib/reportClientError";
import { adminJunkCount, groupGuardCounts, junkToday, positiveJunkCount, restoreProtections, todayWindows, type GuardCountRow, type GuardGroup, type RestoreCountRow } from "@/lib/adminHome";

const FOCUS_REFRESH_MS = 60_000;
const PJ_KEY = "admin-home-positive-junk:v1";
const PJ_REMEMBER_MS = 30 * 60 * 1000;

export interface EngineData {
  recycled: [number, number];
  groups: GuardGroup[];
  protections: { now: number; yesterday: number; earliestEnd: string | null };
  junk: { sweep: [number, number]; admin: [number, number] } | null;
}

function readPj(): { count: number; at: number } | null {
  try {
    const raw = sessionStorage.getItem(PJ_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { count?: unknown; at?: unknown };
    if (typeof v.count !== "number" || typeof v.at !== "number" || Date.now() - v.at >= PJ_REMEMBER_MS) return null;
    return { count: v.count, at: v.at };
  } catch {
    return null;
  }
}

export function useAdminEngine(employeeId: string | null = null) {
  const [engine, setEngine] = useState<{ data: EngineData | null; error: boolean; loading: boolean }>({ data: null, error: false, loading: true });
  const [pj, setPj] = useState<{ count: number | null; at: number | null; error: boolean; loading: boolean }>(() => ({ count: null, at: null, error: false, loading: false }));
  const lastLoad = useRef(0);

  const loadEngine = useCallback(async () => {
    setEngine((s) => ({ ...s, loading: true }));
    const now = Date.now();
    const w = todayWindows(now);
    const recycled = (from: string, to: string) =>
      supabase
        .from("lead_history")
        .select("id", { count: "exact", head: true })
        .eq("assigned_by_type", "SYSTEM")
        .not("recycle_reason", "is", null)
        .gte("assigned_at", from)
        .lt("assigned_at", to)
        .limit(1);
    // lead_guard_events has no client grant: admins read counts through the read-only RPC (is_admin() inside, window <= 3 days).
    const guards = (from: string, to: string) => supabase.rpc("get_admin_guard_event_counts", { p_from: from, p_to: to });
    const junkNotes = (from: string, to: string) =>
      employeeId
        ? supabase
            .from("notification")
            .select("id", { count: "exact", head: true })
            .eq("type", "LEAD_JUNKED")
            .eq("employee_id", employeeId)
            .gte("created_at", from)
            .lt("created_at", to)
            .limit(1)
        : Promise.resolve({ count: null, error: null });
    const [rt, ry, gt, gy, rs, nt, ny] = await Promise.all([
      recycled(w.today.from, w.today.to),
      recycled(w.yesterday.from, w.yesterday.to),
      guards(w.today.from, w.today.to),
      guards(w.yesterday.from, w.yesterday.to),
      // Open restore protections now and 24 h ago, counted in the database (no 200-row cap, no lead ids).
      supabase.rpc("get_admin_restore_protection_counts", { p_at: new Date(now).toISOString() }),
      junkNotes(w.today.from, w.today.to),
      junkNotes(w.yesterday.from, w.yesterday.to)
    ]);
    const err = rt.error || ry.error || gt.error || gy.error || rs.error || nt.error || ny.error;
    if (err) {
      reportClientError("admin-home:engine", err.message, "warning");
      setEngine({ data: null, error: true, loading: false });
      return;
    }
    const prot = restoreProtections(rs.data as RestoreCountRow[] | RestoreCountRow | null);
    setEngine({
      data: {
        recycled: [rt.count ?? 0, ry.count ?? 0],
        groups: groupGuardCounts(gt.data as GuardCountRow[], gy.data as GuardCountRow[]),
        protections: prot,
        junk: employeeId
          ? (() => {
              const t = junkToday(nt.count ?? 0, adminJunkCount(gt.data as GuardCountRow[]));
              const y = junkToday(ny.count ?? 0, adminJunkCount(gy.data as GuardCountRow[]));
              return { sweep: [t.sweep, y.sweep], admin: [t.admin, y.admin] };
            })()
          : null
      },
      error: false,
      loading: false
    });
  }, [employeeId]);

  const checkPositiveJunk = useCallback(async () => {
    setPj((s) => ({ ...s, loading: true, error: false }));
    const { data, error } = await supabase.rpc("get_positive_junk_leads");
    if (error) {
      reportClientError("admin-home:positive-junk", error.message, "warning");
      setPj((s) => ({ ...s, loading: false, error: true }));
      return;
    }
    const count = positiveJunkCount(data as { rows?: unknown[] });
    const at = Date.now();
    try {
      sessionStorage.setItem(PJ_KEY, JSON.stringify({ count, at }));
    } catch {
      // a private window simply asks again
    }
    setPj({ count, at, error: false, loading: false });
  }, []);

  const refresh = useCallback(() => {
    lastLoad.current = Date.now();
    void loadEngine();
  }, [loadEngine]);

  useEffect(() => {
    const saved = readPj();
    if (saved) setPj({ count: saved.count, at: saved.at, error: false, loading: false });
    refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoad.current >= FOCUS_REFRESH_MS) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  return { engine, pj, refresh, checkPositiveJunk, retry: loadEngine };
}
