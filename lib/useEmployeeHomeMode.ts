"use client";
// Employee Home Phase 1 (2026-11-18): is the new Home on for this employee? Never delays the old Home.
//   * The old Home renders at once; this answers false until the setting is known.
//   * lead_engine_settings is read in the background, at most once per 30 minutes per browser tab (sessionStorage), with
//     a 2 s timeout. A missing column, an unknown value, an error or a timeout all mean off; only a real answer is
//     remembered, so a slow or failed read is tried again on the next visit.
//   * Remembered "on" shows the new Home straight away on the next visit. Turning the flag off reaches every open tab
//     within 30 minutes, and at once on a new tab or app start.
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { homeModeAllows } from "@/lib/employeeHome";

const KEY = "employee-home-mode:v1:";
export const HOME_MODE_REMEMBER_MS = 30 * 60 * 1000;
export const HOME_MODE_TIMEOUT_MS = 2000;

// E5: other screens (ResumeCallStrip) read only this remembered answer - never a database read of their own.
export function rememberedHomeMode(employeeId: string | null | undefined): boolean {
  return employeeId ? readRemembered(employeeId) === true : false;
}

function readRemembered(employeeId: string): boolean | null {
  try {
    const raw = sessionStorage.getItem(KEY + employeeId);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { on?: unknown; at?: unknown };
    if (typeof saved.on !== "boolean" || typeof saved.at !== "number") return null;
    return Date.now() - saved.at < HOME_MODE_REMEMBER_MS ? saved.on : null;
  } catch {
    return null;
  }
}

function remember(employeeId: string, on: boolean) {
  try {
    sessionStorage.setItem(KEY + employeeId, JSON.stringify({ on, at: Date.now() }));
  } catch {
    // ignore: a private window simply asks again next time
  }
}

export function useEmployeeHomeMode(employeeId: string | null | undefined): boolean {
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!employeeId) return;
    const saved = readRemembered(employeeId);
    if (saved !== null) {
      setOn(saved);
      return;
    }
    let done = false;
    const timer = setTimeout(() => {
      done = true;
    }, HOME_MODE_TIMEOUT_MS);
    Promise.resolve(supabase.from("lead_engine_settings").select("*").eq("id", 1).maybeSingle()).then(
      ({ data, error }) => {
        if (done) return;
        clearTimeout(timer);
        done = true;
        if (error) return;
        const allowed = homeModeAllows(data as Record<string, unknown> | null, employeeId);
        remember(employeeId, allowed);
        setOn(allowed);
      },
      () => {
        clearTimeout(timer);
        done = true;
      }
    );
    return () => {
      clearTimeout(timer);
      done = true;
    };
  }, [employeeId]);

  // A remembered answer is used in this same render (the Home only renders after the login check, in the browser), so
  // a remembered "on" never mounts the old social card first.
  const remembered = employeeId ? readRemembered(employeeId) : null;
  return remembered ?? on;
}
