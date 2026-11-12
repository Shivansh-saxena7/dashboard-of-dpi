import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { needsCallByLeadId, needsCallUnavailable, readNeedsCallCache, type NeedsCallLead, type NeedsCallState } from "@/lib/needsYourCall";

const cacheKey = (employeeId: string) => `needs_your_call:${employeeId}`;
const OFF: NeedsCallState = { enabled: false, byLeadId: new Map() };

// One call when the page opens, then the session cache for 5 minutes. No timer and no realtime. If the function is
// missing or refused, the option stays hidden.
export function useNeedsYourCall(employeeId: string | null | undefined): NeedsCallState {
  const [state, setState] = useState<NeedsCallState>(OFF);

  useEffect(() => {
    if (!employeeId) return;
    let active = true;
    let cached = null;
    try {
      cached = readNeedsCallCache(sessionStorage.getItem(cacheKey(employeeId)), Date.now());
    } catch {
      cached = null;
    }
    if (cached) {
      setState({ enabled: true, byLeadId: needsCallByLeadId(cached.leads) });
      return;
    }
    (async () => {
      const { data, error } = await supabase.rpc("get_my_guard_held_leads");
      if (!active) return;
      if (error) {
        if (!needsCallUnavailable(error)) console.warn("get_my_guard_held_leads", error.message);
        setState(OFF);
        return;
      }
      const leads = (data?.leads ?? []) as NeedsCallLead[];
      setState({ enabled: true, byLeadId: needsCallByLeadId(leads) });
      try {
        sessionStorage.setItem(cacheKey(employeeId), JSON.stringify({ at: Date.now(), leads }));
      } catch {
        // no storage, the next page open just asks again
      }
    })();
    return () => {
      active = false;
    };
  }, [employeeId]);

  return state;
}
