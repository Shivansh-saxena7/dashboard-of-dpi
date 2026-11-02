import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { contextByLeadId, type GivenLeadContext } from "@/lib/givenLeadContext";

const EMPTY = { enabled: false, byLeadId: new Map<string, GivenLeadContext>() };

// The caller's "Given by admin" leads. Reloads shortly after the list itself reloads (`reloadKey`
// changes on every realtime update), so a first call takes the lead out of the filter straight away.
// While the feature flag does not include this employee the function answers enabled = false and
// nothing shows.
export function useGivenLeadContext(reloadKey: unknown) {
  const [state, setState] = useState(EMPTY);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc("get_given_lead_context");
      if (cancelled) return;
      if (error || !data?.enabled) {
        setState(EMPTY);
        return;
      }
      setState({ enabled: true, byLeadId: contextByLeadId(data.leads) });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reloadKey]);

  return state;
}
