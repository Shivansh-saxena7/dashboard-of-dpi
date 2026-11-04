import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { previousPositiveByLeadId, readPreviousPositiveCache, type DataPreviousPositive } from "@/lib/dataPreviousPositive";

const cacheKey = (employeeId: string) => `data_previous_positive:${employeeId}`;

// One call when the Data page opens, then the session cache for 5 minutes. No timer, no realtime, no call from the detail
// view. If the function is missing or refused, the box simply stays hidden.
export function useDataPreviousPositive(employeeId: string | null | undefined) {
  const [byLeadId, setByLeadId] = useState(() => new Map<string, DataPreviousPositive>());

  useEffect(() => {
    if (!employeeId) return;
    let active = true;
    let cached = null;
    try {
      cached = readPreviousPositiveCache(sessionStorage.getItem(cacheKey(employeeId)), Date.now());
    } catch {
      cached = null;
    }
    if (cached) {
      setByLeadId(previousPositiveByLeadId(cached.leads));
      return;
    }
    (async () => {
      const { data, error } = await supabase.rpc("get_data_previous_positive");
      if (!active || error) return;
      const leads = (data?.leads ?? []) as DataPreviousPositive[];
      setByLeadId(previousPositiveByLeadId(leads));
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

  return byLeadId;
}
