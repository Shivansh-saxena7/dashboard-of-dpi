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

// true = the redesign card (LeadCardV2 / DataCardV2), false = the old card. The list never waits for this:
//   * Starts with what this session remembered, otherwise the old card (flag off / missing / slow = old card at once).
//   * When the answer arrives and differs, the card switches only if the person has not touched the page yet
//     (pointerdown / touchstart / keydown / wheel since the list opened), so a card never changes under a tap. Touched
//     already: this visit keeps the current card; the answer is remembered, so the next load shows the right one.
export const CARD_SWAP_EVENTS = ["pointerdown", "touchstart", "keydown", "wheel"] as const;
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
    let touched = false;
    const touch = () => {
      touched = true;
    };
    for (const ev of CARD_SWAP_EVENTS) window.addEventListener(ev, touch, { capture: true, passive: true });
    void readMode(employeeId).then((v) => {
      if (alive && !touched) setOn(v);
    });
    return () => {
      alive = false;
      for (const ev of CARD_SWAP_EVENTS) window.removeEventListener(ev, touch, { capture: true });
    };
  }, [employeeId]);
  return on;
}

// List containers (2026-11-26 desktop grid). The old card keeps exactly the old class. The new card uses the same
// class below 1024 px and, from 1024 px, a grid of columns at least 460 px wide (2 columns at 1024-1400 px, 3 at
// 1440, 4 at 1920), cards at their own height; when the queue bar is open, extra room at the bottom on desktop.
export const CARD_LIST_CLASS = "mx-4 mt-4 space-y-3 pb-6";
export const CARD_GRID_CLASS = "lg:grid lg:grid-cols-[repeat(auto-fill,minmax(460px,1fr))] lg:items-start lg:gap-3 lg:space-y-0";
