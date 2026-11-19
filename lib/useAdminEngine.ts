"use client";
// Admin Home A3 (2026-11-19): Lead engine today + positive-history junk. Read-only, bounded, no polling, no channel.
//   * Recycled today: count-only (HEAD) on lead_history (SYSTEM + recycle_reason), today vs yesterday at this time.
//   * Guard / hold events: lead_guard_events for the two windows (limit 500 each), grouped in the browser.
//   * Restore protections: lead_restore_log rows that could be open now or 24 h ago (limit 200), counted at both times.
//   * Positive-history junk: get_positive_junk_leads() returns the whole list (it scans every Junk lead), so it never
//     runs on load or Refresh: only on "Check", once; the count (the page's "All") is remembered for the tab, 30 min.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { reportClientError } from "@/lib/reportClientError";
import { groupGuardEvents, openProtections, positiveJunkCount, todayWindows, type GuardEventLite, type GuardGroup, type RestoreRow } from "@/lib/adminHome";

export const ENGINE_LIMITS = { guard: 500, restore: 200 };
const FOCUS_REFRESH_MS = 60_000;
const PJ_KEY = "admin-home-positive-junk:v1";
const PJ_REMEMBER_MS = 30 * 60 * 1000;

export interface EngineData {
  recycled: [number, number];
  groups: GuardGroup[];
  protections: { now: number; yesterday: number; earliestEnd: string | null };
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

export function useAdminEngine() {
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
    const guards = (from: string, to: string) =>
      supabase.from("lead_guard_events").select("source, action").gte("created_at", from).lt("created_at", to).limit(ENGINE_LIMITS.guard);
    const [rt, ry, gt, gy, rs] = await Promise.all([
      recycled(w.today.from, w.today.to),
      recycled(w.yesterday.from, w.yesterday.to),
      guards(w.today.from, w.today.to),
      guards(w.yesterday.from, w.yesterday.to),
      // Any protection that was still running 24 h ago (or is now): enough to count open ones at both moments.
      supabase.from("lead_restore_log").select("protected_until, restored_at, undone_at").gt("protected_until", w.yesterday.to).limit(ENGINE_LIMITS.restore)
    ]);
    const err = rt.error || ry.error || gt.error || gy.error || rs.error;
    if (err) {
      reportClientError("admin-home:engine", err.message, "warning");
      setEngine({ data: null, error: true, loading: false });
      return;
    }
    const nowOpen = openProtections(rs.data as RestoreRow[], now);
    const thenOpen = openProtections(rs.data as RestoreRow[], now - 86400e3);
    setEngine({
      data: {
        recycled: [rt.count ?? 0, ry.count ?? 0],
        groups: groupGuardEvents(gt.data as GuardEventLite[], gy.data as GuardEventLite[]),
        protections: { now: nowOpen.count, yesterday: thenOpen.count, earliestEnd: nowOpen.earliestEnd }
      },
      error: false,
      loading: false
    });
  }, []);

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
