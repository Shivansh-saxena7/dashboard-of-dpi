import { supabase } from "@/lib/supabase";
import { rememberPendingOutcome } from "@/lib/lastCalledLead";
import { attachActiveCallClickId, startActiveCall } from "@/lib/activeCall";
import { isNetworkFailure, RETRY_DELAY_MS } from "@/lib/resilientLeadUpdate";

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
  // Call-return (2026-11-13): remember this call in localStorage before the dialer opens (lib/activeCall.ts).
  startActiveCall(leadId);
  send(leadHistoryId, leadId, false);
}

// One automatic retry on a network failure (2026-11-14). Safe against double counting: log_call_click_atomic
// ignores a second click on the same assignment within 30 seconds and returns the click it already has, and the
// retry goes out after RETRY_DELAY_MS (3 s). A server answer (not authorized, no active assignment) is not retried.
function send(leadHistoryId: string, leadId: string, isRetry: boolean) {
  supabase
    .rpc("log_call_click_atomic", { p_lead_history_id: leadHistoryId })
    .then(({ data, error, status }) => {
      if (error) {
        console.error("log_call_click_atomic failed:", error.message);
        if (!isRetry && isNetworkFailure({ error, status })) setTimeout(() => send(leadHistoryId, leadId, true), RETRY_DELAY_MS);
        return;
      }
      rememberPendingOutcome(leadId, typeof data === "string" ? data : null);
      attachActiveCallClickId(leadId, typeof data === "string" ? data : null);
    });
}
