import { useEffect, useRef } from "react";
import { consumePendingOutcome } from "@/lib/lastCalledLead";

// Call Quality (2026-10-28) — back from the dialer, open that lead's detail
// modal so the outcome is logged while the call is fresh. Shared by LeadList
// and DataList (same pattern as the scroll-restore helpers). Checks once the
// list has loaded (covers a tab the browser reloaded during the call) and on
// every return to the tab. A lead that is no longer in this list (recycled,
// other tab) is silently skipped; the server-side nudge still covers it.
export function usePendingOutcomeSheet(loading: boolean, leads: { id: string }[], open: (leadId: string) => void) {
  const leadsRef = useRef(leads);
  const openRef = useRef(open);
  useEffect(() => {
    leadsRef.current = leads;
    openRef.current = open;
  });

  useEffect(() => {
    if (loading) return;

    function check() {
      if (document.visibilityState !== "visible") return;
      const leadId = consumePendingOutcome();
      if (leadId && leadsRef.current.some((lead) => lead.id === leadId)) {
        openRef.current(leadId);
      }
    }

    check();
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, [loading]);
}
