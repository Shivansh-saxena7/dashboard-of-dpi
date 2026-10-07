"use client";

// Browser side of the working calendar (2026-10-07, Step 4): one
// get_working_calendar call shared by every card on the page (module-level
// cache, refreshed every 10 minutes), so a list of 60 lead cards still
// makes one RPC, not 60. Returns null until loaded or if the call fails —
// timers then fall back to plain calendar time, which is also the
// switch-OFF behaviour; a failure is reported to /admin/system-health
// rather than swallowed.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchWorkingCalendar, DAY_MS, type WorkingCalendar } from "@/lib/workingCalendar";
import { reportClientError } from "@/lib/reportClientError";

const REFRESH_MS = 10 * 60 * 1000;

let cached: { calendar: WorkingCalendar; fetchedAt: number } | null = null;
let inFlight: Promise<WorkingCalendar | null> | null = null;
const listeners = new Set<(calendar: WorkingCalendar | null) => void>();
// One refresh timer for the whole page, alive while any card is mounted.
let refreshTimer: ReturnType<typeof setInterval> | null = null;

// Same window every caller uses: far enough back for the oldest live
// timer start, far enough ahead for any cutoff or pause end.
export function loadWorkingCalendar(): Promise<WorkingCalendar | null> {
  if (cached && Date.now() - cached.fetchedAt < REFRESH_MS) return Promise.resolve(cached.calendar);
  if (inFlight) return inFlight;
  const now = Date.now();
  inFlight = fetchWorkingCalendar(supabase, now - 60 * DAY_MS, now + 400 * DAY_MS)
    .then((calendar) => {
      cached = { calendar, fetchedAt: Date.now() };
      listeners.forEach((listener) => listener(calendar));
      return calendar;
    })
    .catch((err) => {
      reportClientError("useWorkingCalendar:get_working_calendar", err, "warning");
      return cached?.calendar ?? null;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function useWorkingCalendar(): WorkingCalendar | null {
  const [calendar, setCalendar] = useState<WorkingCalendar | null>(cached?.calendar ?? null);

  useEffect(() => {
    listeners.add(setCalendar);
    loadWorkingCalendar();
    if (!refreshTimer) refreshTimer = setInterval(loadWorkingCalendar, REFRESH_MS);
    return () => {
      listeners.delete(setCalendar);
      if (listeners.size === 0 && refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
    };
  }, []);

  return calendar;
}
