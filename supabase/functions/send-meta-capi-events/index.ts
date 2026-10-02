// @ts-nocheck

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.0";

// Meta Conversions API sender (feature/meta-capi-integration,
// 2026-08-19) — the ONLY thing in this whole feature that ever calls
// out to Meta. The 4 hooks in log_lead_update_atomic/
// move_lead_to_followup_atomic/log_site_visit_atomic/log_booking_atomic
// only ever do a cheap local insert into meta_capi_events_log (their
// own transaction, never blocked by this); this function drains that
// outbox on its own pg_cron schedule, fully decoupled from any
// employee action.
//
// Dataset resolution happens HERE, not at insert time — an outbox row
// only ever carries lead_id/meta_lead_id/tier. Which Meta Dataset (and
// its Access Token) applies is resolved fresh on every send attempt
// via leads.project -> projects.meta_dataset_id -> meta_datasets, so a
// project re-linked to a different dataset after an event was queued
// sends via the CURRENT mapping, never a stale one.
//
// "SENT" is only ever set after genuinely parsing Meta's own response
// body and confirming success (events_received >= 1, no `error` key)
// — never merely "the POST didn't throw." An ambiguous/unparseable
// response is treated as a failure needing retry, on purpose — see
// isGenuineSuccess below.
//
// Access tokens are read via get_meta_dataset_credentials (a public-
// schema SECURITY DEFINER RPC) rather than queried directly — the
// service-role JS client talks to Postgres through PostgREST, which
// only exposes the `public` schema; vault.decrypted_secrets isn't
// reachable from here any other way. See that RPC's own comment.

const GRAPH_API_VERSION = Deno.env.get("META_GRAPH_API_VERSION") || "v26.0";
const MAX_SEND_ATTEMPTS = 5;

function respond(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

// Deliberately conservative: only a response that positively confirms
// receipt counts as success. Anything else (network error, non-2xx, a
// present `error` key, a missing/zero events_received, or a body that
// doesn't even parse as the expected shape) is treated as a failure —
// exactly the "don't just trust that the POST didn't throw" guarantee
// this feature was built to provide.
function isGenuineSuccess(responseJson: any): boolean {
  if (!responseJson || typeof responseJson !== "object") return false;
  if (responseJson.error) return false;
  return typeof responseJson.events_received === "number" && responseJson.events_received >= 1;
}

async function notifyAdminsOfFailure(supabase: any, leadId: string, tier: string, reason: string) {
  try {
    const { data: activeAdmins } = await supabase
      .from("employees")
      .select("id, name")
      .eq("role", "admin")
      .eq("is_active", true);

    for (const admin of activeAdmins || []) {
      await supabase.from("notification").insert({
        employee_id: admin.id,
        employee_name: admin.name || "",
        title: "Meta CAPI signal failed",
        message: `A "${tier}" signal for a lead could not be sent to Meta after ${MAX_SEND_ATTEMPTS} attempts: ${reason}`,
        type: "META_CAPI_FAILED",
        is_read: false
      });
    }
  } catch (notifyError: any) {
    console.error("send-meta-capi-events: also failed to send failure notification:", notifyError.message);
  }
}

serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: pendingEvents, error: fetchError } = await supabase
      .from("meta_capi_events_log")
      .select("id, lead_id, meta_lead_id, event_tier, meta_event_name, send_attempts, leads(project)")
      .eq("status", "PENDING")
      .order("queued_at", { ascending: true })
      .limit(200);

    if (fetchError) {
      return respond({ success: false, step: "FETCH_PENDING", error: fetchError.message }, 500);
    }

    let sentCount = 0;
    let failedCount = 0;
    let retriedCount = 0;
    const diagnostics: any[] = [];

    for (const event of pendingEvents || []) {

      const project = event.leads?.project;

      // Resolves via resolve_project_meta_dataset (2026-08-21) —
      // matches this codebase's existing lead-project-matching
      // convention (get_lead_project_assets: case/whitespace-
      // insensitive exact match, then project_aliases fallback),
      // rather than the raw case-sensitive .eq("name", project) this
      // used before. Root-caused live: a lead's free-text project
      // ("Kviraaj Mayfair") not exactly matching the canonical
      // projects.name ("Kviraaj Mayfair Residency") produced false
      // "no dataset linked" failures even though the Dataset was
      // genuinely linked — this is exactly the class of mismatch
      // project_aliases already exists to solve elsewhere in the app.
      //
      // No project on the lead, or genuinely no dataset resolvable —
      // a config/data gap, not a transient error. Retrying won't fix
      // it, so this fails immediately (no attempt-count spent) and
      // alerts once, same as the Google Sheets fix's non-retryable-4xx
      // principle.
      const { data: resolvedDatasetId } = project
        ? await supabase.rpc("resolve_project_meta_dataset", { p_project_text: project })
        : { data: null };

      if (!resolvedDatasetId) {
        const reason = `No Meta Dataset linked to project "${project || "(lead has no project set)"}"`;
        await supabase
          .from("meta_capi_events_log")
          .update({ status: "FAILED", last_error: reason })
          .eq("id", event.id);
        await notifyAdminsOfFailure(supabase, event.lead_id, event.event_tier, reason);
        failedCount++;
        diagnostics.push({ eventId: event.id, action: "FAILED", reason: "no dataset linked" });
        continue;
      }

      const { data: credRows, error: credError } = await supabase.rpc("get_meta_dataset_credentials", {
        p_dataset_row_id: resolvedDatasetId
      });

      const creds = Array.isArray(credRows) ? credRows[0] : null;

      if (credError || !creds) {
        const reason = credError?.message || "Meta Dataset not found or inactive";
        await supabase
          .from("meta_capi_events_log")
          .update({ status: "FAILED", last_error: reason, resolved_dataset_id: resolvedDatasetId })
          .eq("id", event.id);
        await notifyAdminsOfFailure(supabase, event.lead_id, event.event_tier, reason);
        failedCount++;
        diagnostics.push({ eventId: event.id, action: "FAILED", reason: "dataset credentials missing" });
        continue;
      }

      const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${creds.dataset_id}/events?access_token=${encodeURIComponent(creds.access_token)}`;

      const payload = {
        data: [
          {
            event_name: event.meta_event_name,
            event_time: Math.floor(Date.now() / 1000),
            action_source: "system_generated",
            event_id: event.id,
            user_data: {
              lead_id: event.meta_lead_id
            }
          }
        ]
      };

      let responseJson: any = null;
      let networkError: string | null = null;

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        responseJson = await res.json().catch(() => null);
      } catch (err: any) {
        networkError = err.message;
      }

      if (!networkError && isGenuineSuccess(responseJson)) {
        await supabase
          .from("meta_capi_events_log")
          .update({
            status: "SENT",
            sent_at: new Date().toISOString(),
            resolved_dataset_id: resolvedDatasetId,
            meta_response_summary: `events_received=${responseJson.events_received}${responseJson.fbtrace_id ? `, fbtrace_id=${responseJson.fbtrace_id}` : ""}`
          })
          .eq("id", event.id);
        sentCount++;
        diagnostics.push({ eventId: event.id, action: "SENT" });
        continue;
      }

      // Genuine failure — network error, non-2xx, an `error` key in
      // the body, or a response that didn't confirm receipt.
      const errorMessage =
        networkError ||
        responseJson?.error?.message ||
        (responseJson ? `Unexpected response: ${JSON.stringify(responseJson).slice(0, 500)}` : "Empty/unparseable response from Meta");

      // Meta's own error object says explicitly whether retrying could
      // ever help (root-caused live, 2026-08-21: an invalid/fake
      // lead_id came back with is_transient: false — retrying that 5
      // times just burns 4 wasted cron cycles before landing on the
      // exact same permanent rejection). A network error/unparseable
      // response has no such field and is treated as potentially
      // transient by default (undefined !== false), same as before.
      const isPermanentFailure = responseJson?.error?.is_transient === false;

      const nextAttempts = (event.send_attempts || 0) + 1;

      if (isPermanentFailure || nextAttempts >= MAX_SEND_ATTEMPTS) {
        await supabase
          .from("meta_capi_events_log")
          .update({
            status: "FAILED",
            send_attempts: nextAttempts,
            last_error: errorMessage,
            resolved_dataset_id: resolvedDatasetId
          })
          .eq("id", event.id);
        await notifyAdminsOfFailure(supabase, event.lead_id, event.event_tier, errorMessage);
        failedCount++;
        diagnostics.push({
          eventId: event.id,
          action: "FAILED",
          reason: errorMessage,
          cause: isPermanentFailure ? "permanent (Meta: not transient)" : "attempts exhausted"
        });
      } else {
        await supabase
          .from("meta_capi_events_log")
          .update({
            send_attempts: nextAttempts,
            last_error: errorMessage,
            resolved_dataset_id: resolvedDatasetId
          })
          .eq("id", event.id);
        retriedCount++;
        diagnostics.push({ eventId: event.id, action: "RETRY_SCHEDULED", attempt: nextAttempts, reason: errorMessage });
      }
    }

    return respond({
      success: true,
      totalChecked: (pendingEvents || []).length,
      sentCount,
      failedCount,
      retriedCount,
      diagnostics
    });

  } catch (error: any) {
    console.error("send-meta-capi-events failed:", error.message);
    return respond({ success: false, message: error.message }, 500);
  }
});
