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
import { fetchWorkingCalendar, timersPausedDisplay, DAY_MS, type TimersPausedDisplay, type WorkingCalendar } from "@/lib/workingCalendar";
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

// One shared minute tick for every "timers paused" banner/badge on the
// page, so a pause that ends while the page is open disappears by itself.
let minuteTimer: ReturnType<typeof setInterval> | null = null;
const minuteListeners = new Set<(now: number) => void>();

function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    minuteListeners.add(setNow);
    if (!minuteTimer) minuteTimer = setInterval(() => minuteListeners.forEach((listener) => listener(Date.now())), 60 * 1000);
    return () => {
      minuteListeners.delete(setNow);
      if (minuteListeners.size === 0 && minuteTimer) {
        clearInterval(minuteTimer);
        minuteTimer = null;
      }
    };
  }, []);
  return now;
}

// Step 8: "Timers paused" right now (weekly off / Admin range), or null
// when timers are running or the working-days switch is OFF.
export function useTimersPaused(): TimersPausedDisplay | null {
  const calendar = useWorkingCalendar();
  const now = useMinuteTick();
  return timersPausedDisplay(calendar, now);
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
