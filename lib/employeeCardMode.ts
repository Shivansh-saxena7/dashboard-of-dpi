"use client";
// Which lead / data card an employee sees (2026-11-26): lead_engine_settings.employee_card_mode = 'off' (default) |
// 'admin_pilot' (only employee_card_pilot_ids) | 'on'. Read in the background with a 2 s timeout and remembered for
// 30 minutes in sessionStorage (same pattern as reassigned_journey_mode). A missing column, an unknown value, an error
// or a slow answer = the old card. No polling, no realtime.
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export const CARD_MODE_TIMEOUT_MS = 2000;
export const CARD_MODE_REMEMBER_MS = 30 * 60 * 1000;
const KEY = "employee-card-mode:v1:";

export function cardModeAllows(settings: Record<string, unknown> | null | undefined, employeeId: string | null | undefined): boolean {
  if (!employeeId) return false;
  const mode = settings?.employee_card_mode;
  if (mode === "on") return true;
  if (mode !== "admin_pilot") return false;
  const pilots = settings?.employee_card_pilot_ids;
  return Array.isArray(pilots) && pilots.includes(employeeId);
}
export function readRememberedCardMode(raw: string | null | undefined, nowMs: number): boolean | null {
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as { on?: unknown; at?: unknown };
    if (typeof saved.on !== "boolean" || typeof saved.at !== "number") return null;
    return nowMs - saved.at < CARD_MODE_REMEMBER_MS ? saved.on : null;
  } catch {
    return null;
  }
}

async function readMode(employeeId: string): Promise<boolean> {
  try {
    const saved = readRememberedCardMode(sessionStorage.getItem(KEY + employeeId), Date.now());
    if (saved !== null) return saved;
  } catch {
    // no storage: ask the database
  }
  const read = Promise.resolve(supabase.from("lead_engine_settings").select("*").eq("id", 1).maybeSingle()).then(
    ({ data, error }) => {
      if (error) return null;
      const on = cardModeAllows(data as Record<string, unknown> | null, employeeId);
      try {
        sessionStorage.setItem(KEY + employeeId, JSON.stringify({ on, at: Date.now() }));
      } catch {
        // a private window simply asks again next time
      }
      return on;
    },
    () => null
  );
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), CARD_MODE_TIMEOUT_MS));
  return (await Promise.race([read, timeout])) === true;
}

// true = the redesign card (LeadCardV2 / DataCardV2). Starts false (old card) until the flag is known.
export function useEmployeeCardMode(employeeId: string | null | undefined): boolean {
  const [on, setOn] = useState<boolean>(() => {
    if (!employeeId || typeof window === "undefined") return false;
    try {
      return readRememberedCardMode(sessionStorage.getItem(KEY + employeeId), Date.now()) === true;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (!employeeId) return;
    let alive = true;
    void readMode(employeeId).then((v) => {
      if (alive) setOn(v);
    });
    return () => {
      alive = false;
    };
  }, [employeeId]);
  return on;
}
