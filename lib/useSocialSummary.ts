"use client";
// Social posts summary (2026-11-19, Employee Home E7): one line on the collapsed social card, from the same rows the
// card itself shows (the employee's own tracking rows for the card's default date), without /api/data. One small
// read: own rows (RLS + .eq), one date, at most 50. Loaded once and when the app comes back (at most once a minute);
// not at all while the card is open (the card then shows everything itself).
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { socialSummary, type SocialSummary } from "@/lib/employeeHome";

export { socialSummaryText } from "@/lib/employeeHome";

export const SOCIAL_SUMMARY_LIMIT = 50;
const FOCUS_REFRESH_MS = 60_000;

export function useSocialSummary(employeeId: string | null | undefined, enabled: boolean) {
  const [summary, setSummary] = useState<SocialSummary | null>(null);
  const lastLoad = useRef(0);

  const load = useCallback(async () => {
    if (!employeeId || !enabled) return;
    lastLoad.current = Date.now();
    // Same default date as components/PostsTrackingView.tsx, so the line matches the card when it is opened.
    const date = new Date().toISOString().split("T")[0];
    const { data, error } = await supabase
      .from("tracking")
      .select("ig_done, fb_done")
      .eq("employee_id", employeeId)
      .eq("date", date)
      .limit(SOCIAL_SUMMARY_LIMIT);
    setSummary(error ? null : socialSummary(data as { ig_done: boolean; fb_done: boolean }[]));
  }, [employeeId, enabled]);

  useEffect(() => {
    load();
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoad.current >= FOCUS_REFRESH_MS) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, load]);

  return summary;
}
