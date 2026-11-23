"use client";
// "Previously with" tags for the lead list (2026-11-23). Never delays or changes the list:
//   * The flag (lead_engine_settings.reassigned_journey_mode) is read in the background with a 2 s timeout and
//     remembered for 30 minutes in sessionStorage. A missing column, an unknown value, an error or a timeout = off.
//   * Only when on: ONE call, get_my_reassigned_leads (no arguments, no id list anywhere), for the whole list. Asked
//     again when the employee comes back to the page (at most once a minute). No polling, no realtime channel.
//   * Off or any failure: an empty map, so no card shows anything new.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { byLeadId, journeyModeAllows, JOURNEY_MODE_TIMEOUT_MS, readRememberedMode, type ReassignedContext, type ReassignedLead } from "@/lib/reassignedJourney";

const KEY = "reassigned-journey-mode:v1:";
const EMPTY = new Map<string, ReassignedLead>();
export const JOURNEY_REFRESH_MS = 60 * 1000;

function remembered(employeeId: string): boolean | null {
  try {
    return readRememberedMode(sessionStorage.getItem(KEY + employeeId), Date.now());
  } catch {
    return null;
  }
}
function remember(employeeId: string, on: boolean) {
  try {
    sessionStorage.setItem(KEY + employeeId, JSON.stringify({ on, at: Date.now() }));
  } catch {
    // a private window simply asks again next time
  }
}

async function modeOn(employeeId: string): Promise<boolean> {
  const saved = remembered(employeeId);
  if (saved !== null) return saved;
  const read = Promise.resolve(supabase.from("lead_engine_settings").select("*").eq("id", 1).maybeSingle()).then(
    ({ data, error }) => {
      if (error) return null;
      const on = journeyModeAllows(data as Record<string, unknown> | null, employeeId);
      remember(employeeId, on);
      return on;
    },
    () => null
  );
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), JOURNEY_MODE_TIMEOUT_MS));
  return (await Promise.race([read, timeout])) === true;
}

export function useReassignedJourney(employeeId: string | null | undefined) {
  const [tags, setTags] = useState<Map<string, ReassignedLead>>(EMPTY);
  const [enabled, setEnabled] = useState(false);
  const last = useRef(0);

  const load = useCallback(async () => {
    if (!employeeId) return;
    last.current = Date.now();
    if (!(await modeOn(employeeId))) {
      setEnabled(false);
      setTags(EMPTY);
      return;
    }
    const { data, error } = await supabase.rpc("get_my_reassigned_leads");
    const ok = !error && data && (data as { enabled?: boolean }).enabled === true;
    setEnabled(Boolean(ok));
    setTags(ok ? byLeadId((data as { leads?: ReassignedLead[] }).leads) : EMPTY);
  }, [employeeId]);

  useEffect(() => {
    if (!employeeId) return;
    const first = setTimeout(() => void load(), 0); // background: after the list has rendered
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last.current >= JOURNEY_REFRESH_MS) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [employeeId, load]);

  return { enabled, tags };
}

// One lead's journey, asked only when the employee taps "Journey". Null = nothing to show.
export async function loadReassignedContext(leadId: string) {
  const { data, error } = await supabase.rpc("get_reassigned_lead_context", { p_lead_id: leadId });
  if (error) return { error: true as const };
  return { data: (data ?? null) as ReassignedContext | null };
}
