import { supabase } from "@/lib/supabase";
import type { ContactMethod } from "@/lib/callQuality";
import { clearActiveCall } from "@/lib/activeCall";

export interface LeadUpdateParams {
  p_lead_id: string;
  p_lead_history_id: string;
  p_new_status: string | null;
  p_note: string | null;
  p_reminder_value: number | null;
  p_reminder_unit: string | null;
}

// Employee status/note update from the outcome sheet (LeadDetailModal / DataDetailModal), with the
// Call Quality "How did you talk?" answer (2026-10-29). Until the Call Quality SQL is applied the DB
// function has no p_contact_method argument and PostgREST answers PGRST202 ("function not found"):
// the update is then sent again without it, so saving a result never breaks because of this field.
export async function logLeadUpdate(params: LeadUpdateParams, contactMethod: ContactMethod | null) {
  const result = await sendLeadUpdate(params, contactMethod);
  // Call-return (2026-11-13): a saved result ends the active call for this lead (lib/activeCall.ts).
  if (!result.error && params.p_new_status) clearActiveCall(null, params.p_lead_id);
  return result;
}

async function sendLeadUpdate(params: LeadUpdateParams, contactMethod: ContactMethod | null) {
  if (params.p_new_status && contactMethod) {
    const first = await supabase.rpc("log_lead_update_atomic", { ...params, p_contact_method: contactMethod });
    if (first.error?.code !== "PGRST202") return first;
  }
  return supabase.rpc("log_lead_update_atomic", params);
}
