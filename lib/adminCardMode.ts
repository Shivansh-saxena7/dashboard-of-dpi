"use client";
// Which admin lead card a person sees on /admin/leads and /coordinator (2026-11-27 admin card port):
// lead_engine_settings.admin_card_mode = 'off' (default) | 'admin_pilot' (only admin_card_pilot_ids) | 'on'.
// Same rules as the employee card switch (lib/employeeCardMode.ts): read in the background with a 2 s timeout,
// remembered for 30 minutes in sessionStorage, a missing column / unknown value / error / slow answer = the old card,
// and the list never waits for it (Option B: a late answer swaps the card only before the first touch). No polling,
// no realtime. The pages that use it are already limited to admin, super_admin and sales_coordinator.
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { CARD_MODE_TIMEOUT_MS, CARD_SWAP_EVENTS, readRememberedCardMode } from "@/lib/employeeCardMode";

const KEY = "admin-card-mode:v1:";

export function adminCardModeAllows(settings: Record<string, unknown> | null | undefined, employeeId: string | null | undefined): boolean {
  if (!employeeId) return false;
  const mode = settings?.admin_card_mode;
  if (mode === "on") return true;
  if (mode !== "admin_pilot") return false;
  const pilots = settings?.admin_card_pilot_ids;
  return Array.isArray(pilots) && pilots.includes(employeeId);
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
      const on = adminCardModeAllows(data as Record<string, unknown> | null, employeeId);
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

// true = AdminLeadCardV2, false = the old AdminLeadCard. Starts with what this session remembered, otherwise the old
// card; the answer switches the card only if the person has not touched the page yet (a bulk tick, a scroll, a key).
export function useAdminCardMode(employeeId: string | null | undefined): boolean {
  const [on, setOn] = useState<boolean>(() => {
    if (!employeeId || typeof window === "undefined") return false;
    try {
      return readRememberedCardMode(sessionStorage.getItem(KEY + employeeId), Date.now()) === true;
    } catch {
      return false;
    }
  });
  // Touches are counted from the moment the list mounts, not from when the employee id arrives (the pages look the
  // id up after the first paint), so a tick made before the id is known also blocks the swap.
  const touched = useRef(false);
  useEffect(() => {
    const touch = () => {
      touched.current = true;
    };
    for (const ev of CARD_SWAP_EVENTS) window.addEventListener(ev, touch, { capture: true, passive: true });
    return () => {
      for (const ev of CARD_SWAP_EVENTS) window.removeEventListener(ev, touch, { capture: true });
    };
  }, []);
  useEffect(() => {
    if (!employeeId) return;
    let alive = true;
    try {
      // The id arrives after the first paint: use the remembered answer at once if nobody touched the page yet.
      const saved = readRememberedCardMode(sessionStorage.getItem(KEY + employeeId), Date.now());
      if (saved !== null && !touched.current) setOn(saved);
    } catch {
      // ignore
    }
    void readMode(employeeId).then((v) => {
      if (alive && !touched.current) setOn(v);
    });
    return () => {
      alive = false;
    };
  }, [employeeId]);
  return on;
}
