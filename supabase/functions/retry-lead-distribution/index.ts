// @ts-nocheck

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.0";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveCallingEmployeeId } from "../_shared/auth.ts";
import { fetchDistributionInputs, distributeLeadsBatch } from "../_shared/distributeLeads.ts";

// Admin-only — re-runs round-robin/project-rules distribution over
// whatever leads from one CSV batch are still unassigned (e.g. the
// batch was imported when nobody had started their shift yet). Uses
// the exact same fetchDistributionInputs/distributeLeadsBatch as
// import-leads-csv, so there's one implementation of "how
// distribution actually works," not two that could drift.
//
// The batch's assigned_count/distribution_summary are MERGED with
// (added to) whatever they already held, never overwritten — retrying
// twice must accumulate correctly, not lose the first retry's result.

function respond(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

serve(async (req) => {

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const auth = await resolveCallingEmployeeId(req, supabase, corsHeaders);
    if (auth.errorResponse) return auth.errorResponse;

    const { data: callerEmployee, error: callerEmployeeError } = await supabase
      .from("employees")
      .select("role")
      .eq("id", auth.employeeId)
      .single();

    if (callerEmployeeError || !callerEmployee) {
      return respond({ success: false, message: "Employee record not found" }, 404);
    }

    if (callerEmployee.role !== "admin") {
      return respond({ success: false, message: "Only Admin can retry distribution" }, 403);
    }

    const { batch_id } = await req.json();

    if (!batch_id) {
      return respond({ success: false, message: "batch_id is required" }, 400);
    }

    const { data: batchRow, error: batchRowError } = await supabase
      .from("csv_import_batches")
      .select("id, status, assigned_count, distribution_summary, lead_type")
      .eq("id", batch_id)
      .single();

    if (batchRowError || !batchRow) {
      return respond({ success: false, message: "Batch not found" }, 404);
    }

    if (batchRow.status !== "active") {
      return respond({ success: false, message: "This batch has been deleted" }, 400);
    }

    // Data batches distribute via an Admin-picked employee list that
    // isn't persisted anywhere retryable (it only ever existed in the
    // original import request) — routing any leftover-unassigned rows
    // through this function's round-robin/project-rules path would
    // silently misassign them (wrong employees, plus a real SLA-
    // deadline, which Data leads must never have). Refused outright
    // rather than guessed at; the wizard's UI already hides the Retry
    // button for Data batches for the same reason.
    if (batchRow.lead_type === "DATA") {
      return respond({
        success: false,
        message: "Retry Distribution isn't supported for Data imports — Data bypasses round robin entirely by design."
      }, 400);
    }

    const { data: pendingLeads, error: pendingLeadsError } = await supabase
      .from("leads")
      .select("id, project")
      .eq("csv_import_batch_id", batch_id)
      .is("current_owner_id", null);

    if (pendingLeadsError) {
      return respond(
        { success: false, step: "FETCH_PENDING_LEADS", error: pendingLeadsError.message },
        500
      );
    }

    if (!pendingLeads || pendingLeads.length === 0) {
      return respond({
        success: true,
        message: "No unassigned leads left in this batch",
        assignedCount: 0,
        distributionSummary: {}
      });
    }

    const inputs = await fetchDistributionInputs(supabase);

    if (inputs.error) {
      return respond({ success: false, message: inputs.error }, 500);
    }

    const { assignedCount, distributionSummary, diagnostics } = await distributeLeadsBatch(
      supabase,
      pendingLeads,
      inputs.settings,
      inputs.projectRules,
      inputs.eligibleEmployees,
      inputs.projectPointers,
      [],
      inputs.projectExclusions
    );

    const mergedSummary = { ...(batchRow.distribution_summary || {}) };
    Object.entries(distributionSummary).forEach(([employeeId, count]) => {
      mergedSummary[employeeId] = (mergedSummary[employeeId] || 0) + count;
    });

    await supabase
      .from("csv_import_batches")
      .update({
        assigned_count: (batchRow.assigned_count || 0) + assignedCount,
        distribution_summary: mergedSummary
      })
      .eq("id", batch_id);

    return respond({
      success: true,
      assignedCount,
      stillUnassigned: pendingLeads.length - assignedCount,
      distributionSummary,
      diagnostics
    });

  } catch (err) {

    console.error("retry-lead-distribution: unhandled error:", err.message, err.stack);

    return respond({ success: false, error: err.message }, 500);

  }
});
