import { supabase } from "@/lib/supabase";
import { rememberPendingOutcome } from "@/lib/lastCalledLead";

// The one place every Call button logs its click (Call Quality, 2026-10-28).
// log_call_click_atomic records the click with server time and returns the
// click's id (or the still-open click's id inside the 30-second cooldown);
// remembering it lets the list re-open this lead's outcome sheet when the
// employee comes back from the dialer. Fire-and-forget: the tel: link must
// open immediately and never wait on this.
export function logCallClick(leadHistoryId: string, leadId: string) {
  // Remembered right away (the browser may background or drop this tab the
  // moment the dialer opens), then again with the click id once it arrives.
  rememberPendingOutcome(leadId, null);
  supabase
    .rpc("log_call_click_atomic", { p_lead_history_id: leadHistoryId })
    .then(({ data, error }) => {
      if (error) {
        console.error("log_call_click_atomic failed:", error.message);
        return;
      }
      rememberPendingOutcome(leadId, typeof data === "string" ? data : null);
    });
}
