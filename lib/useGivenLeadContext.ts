import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  contextByLeadId,
  GIVEN_FOCUS_THROTTLE_MS,
  givenFeatureUnavailable,
  givenFlagAllows,
  readGivenCache,
  type GivenLeadContext
} from "@/lib/givenLeadContext";

const EMPTY = { enabled: false, byLeadId: new Map<string, GivenLeadContext>() };
const cacheKey = (employeeId: string) => `given_lead_context:${employeeId}`;

function readCache(employeeId: string) {
  try {
    return readGivenCache(sessionStorage.getItem(cacheKey(employeeId)), Date.now());
  } catch {
    return null;
  }
}

function writeCache(employeeId: string, enabled: boolean, leads: GivenLeadContext[]) {
  try {
    sessionStorage.setItem(cacheKey(employeeId), JSON.stringify({ at: Date.now(), enabled, leads }));
  } catch {
    // no storage, the next load just asks again
  }
}

// The caller's "Given by admin" leads. Loaded once when the page opens (from the session cache if
// recent), when the employee comes back to the page (a call returns here from the dialer), and after a
// result is saved (call refresh()). Not on every realtime update. If the flag does not include this
// employee, the function is never called.
export function useGivenLeadContext(employeeId: string | null | undefined) {
  const [state, setState] = useState(EMPTY);
  const lastLoad = useRef(0);

  const load = useCallback(async () => {
    if (!employeeId) return;
    lastLoad.current = Date.now();
    const { data: settings } = await supabase.from("lead_engine_settings").select("*").eq("id", 1).maybeSingle();
    if (!givenFlagAllows(settings, employeeId)) {
      writeCache(employeeId, false, []);
      setState(EMPTY);
      return;
    }
    const { data, error } = await supabase.rpc("get_given_lead_context");
    if (error || !data?.enabled) {
      // Not there yet, not allowed or off: hidden. Remember it only for the expected cases.
      if (!error || givenFeatureUnavailable(error)) writeCache(employeeId, false, []);
      setState(EMPTY);
      return;
    }
    writeCache(employeeId, true, data.leads);
    setState({ enabled: true, byLeadId: contextByLeadId(data.leads) });
  }, [employeeId]);

  useEffect(() => {
    if (!employeeId) return;
    const cached = readCache(employeeId);
    if (cached) {
      lastLoad.current = cached.at;
      setState(cached.enabled ? { enabled: true, byLeadId: contextByLeadId(cached.leads) } : EMPTY);
    } else {
      load();
    }
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoad.current >= GIVEN_FOCUS_THROTTLE_MS) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [employeeId, load]);

  return { ...state, refresh: load };
}
