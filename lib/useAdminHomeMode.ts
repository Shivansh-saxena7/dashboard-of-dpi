"use client";
// Admin Home A1 (2026-11-19): is the new Admin Home on for this admin? Never delays the old dashboard.
//   * The old dashboard renders at once; this answers off until the setting is known.
//   * The session (local, no network) gives the user; employees + lead_engine_settings are read in the background,
//     once per 30 minutes per tab (sessionStorage), with a 2 s timeout. Missing column, unknown value, error or timeout
//     = off; only a real answer is remembered, so a failed read is tried again next time.
//   * A remembered "on" shows the new Home straight away (same render) on the next visit.
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { adminHomeModeAllows } from "@/lib/adminHome";

const KEY = "admin-home-mode:v1";
export const ADMIN_MODE_REMEMBER_MS = 30 * 60 * 1000;
export const ADMIN_MODE_TIMEOUT_MS = 2000;

interface Remembered {
  on: boolean;
  employeeId: string | null;
}

function readRemembered(): Remembered | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { on?: unknown; at?: unknown; employeeId?: unknown };
    if (typeof saved.on !== "boolean" || typeof saved.at !== "number") return null;
    if (Date.now() - saved.at >= ADMIN_MODE_REMEMBER_MS) return null;
    return { on: saved.on, employeeId: typeof saved.employeeId === "string" ? saved.employeeId : null };
  } catch {
    return null;
  }
}

function remember(value: Remembered) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...value, at: Date.now() }));
  } catch {
    // a private window simply asks again next time
  }
}

export function useAdminHomeMode(): Remembered {
  const [state, setState] = useState<Remembered>({ on: false, employeeId: null });

  useEffect(() => {
    if (readRemembered()) return;
    let done = false;
    const timer = setTimeout(() => {
      done = true;
    }, ADMIN_MODE_TIMEOUT_MS);
    (async () => {
      try {
        const { data: session } = await supabase.auth.getSession();
        const uid = session.session?.user?.id;
        if (!uid) return;
        const [emp, settings] = await Promise.all([
          supabase.from("employees").select("id, role").eq("auth_user_id", uid).maybeSingle(),
          supabase.from("lead_engine_settings").select("*").eq("id", 1).maybeSingle()
        ]);
        if (done || emp.error || settings.error) return;
        const role = (emp.data as { role?: string } | null)?.role;
        const employeeId = (emp.data as { id?: string } | null)?.id ?? null;
        const on = (role === "admin" || role === "super_admin") && adminHomeModeAllows(settings.data as Record<string, unknown> | null, employeeId);
        remember({ on, employeeId });
        setState({ on, employeeId });
      } catch {
        // off
      } finally {
        clearTimeout(timer);
        done = true;
      }
    })();
    return () => {
      clearTimeout(timer);
      done = true;
    };
  }, []);

  // A remembered answer is used in this same render, so a remembered "on" never shows the old dashboard first.
  return readRemembered() ?? state;
}
