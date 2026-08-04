// @ts-nocheck

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeMobile } from "../../../lib/normalizeMobile.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveCallingEmployeeId } from "../_shared/auth.ts";
import { fetchDistributionInputs, distributeLeadsBatch } from "../_shared/distributeLeads.ts";

// Admin-only bulk lead intake — one CSV upload becomes: insert every
// non-duplicate row (unassigned), then a single round-robin/project-
// rules distribution pass over exactly those new leads, via the
// same fetchDistributionInputs/distributeLeadsBatch that
// retry-lead-distribution uses — one implementation of the actual
// assignment loop, not two.
//
// Unlike assign-lead/recycle-stale-leads, this function explicitly
// verifies the caller is an Admin (resolveCallingEmployeeId only
// confirms a valid session + employee record — role is checked here
// on top of that) — bulk writes across potentially hundreds of rows
// in one call is a meaningfully bigger blast radius than a single-
// lead assignment, so "any authenticated employee" isn't enough here.
//
// Duplicate detection uses normalizeMobile (shared with the frontend
// preview step) rather than an exact string match or a DB .in()
// filter — existing leads.mobile values are fetched broadly and
// compared in JS on both sides, since Postgres has no normalized
// index to filter through directly. Fine at this business's lead
// volume; would need a different approach (a normalized column +
// index) at much larger scale.

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
      return respond({ success: false, message: "Only Admin can import leads" }, 403);
    }

    const { rows, source_name, filename } = await req.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      return respond({ success: false, message: "No rows to import" }, 400);
    }

    if (!source_name) {
      return respond({ success: false, message: "source_name is required" }, 400);
    }

    // --- Server-side duplicate re-check (defense-in-depth — the
    // client-side preview could be stale by the time this runs) ---
    const { data: existingLeads, error: existingLeadsError } = await supabase
      .from("leads")
      .select("mobile");

    if (existingLeadsError) {
      return respond(
        { success: false, step: "FETCH_EXISTING_LEADS", error: existingLeadsError.message },
        500
      );
    }

    const existingNormalized = new Set(
      (existingLeads || []).map((l) => normalizeMobile(l.mobile))
    );

    const seenInBatch = new Set();
    const toInsert = [];
    let duplicateCount = 0;

    for (const row of rows) {

      const normalized = normalizeMobile(row.mobile);

      // Mobile is the only genuinely required field — it's what
      // actually lets an employee call the lead. Missing name is a
      // data-quality gap, not grounds to drop the row, so it defaults
      // to "Unknown" rather than being skipped. This mirrors the
      // frontend's own rule exactly (which already sends "Unknown" in
      // practice), but is re-applied here since this is the
      // authoritative check, not something to trust the client for.
      if (!normalized) {
        continue;
      }

      if (existingNormalized.has(normalized) || seenInBatch.has(normalized)) {
        duplicateCount++;
        continue;
      }

      seenInBatch.add(normalized);

      toInsert.push({
        name: row.name || "Unknown",
        mobile: row.mobile,
        email: row.email || null,
        project: row.project || null,
        // A per-row mapped Source column (if the CSV has one) wins
        // over the batch-level source_name for that row — but
        // csv_import_mappings itself is always keyed by source_name,
        // the stable "which platform did this CSV come from" value.
        source: row.source || source_name,
        status: "NEW",
        extra_data: row.extra_data || null
      });

    }

    if (toInsert.length === 0) {
      return respond({
        success: true,
        totalRows: rows.length,
        duplicateCount,
        importedCount: 0,
        assignedCount: 0,
        distributionSummary: {}
      });
    }

    const { data: insertedLeads, error: insertError } = await supabase
      .from("leads")
      .insert(toInsert)
      .select("id, project");

    if (insertError) {
      return respond({ success: false, step: "INSERT_LEADS", error: insertError.message }, 500);
    }

    const { data: batchRow, error: batchError } = await supabase
      .from("csv_import_batches")
      .insert({
        source_name,
        filename: filename || null,
        uploaded_by_employee_id: auth.employeeId,
        total_rows: rows.length,
        duplicate_count: duplicateCount,
        imported_count: insertedLeads.length
      })
      .select()
      .single();

    if (batchError) {
      return respond({ success: false, step: "CREATE_BATCH", error: batchError.message }, 500);
    }

    // Tag every inserted lead with this batch — retry-lead-distribution
    // and delete_csv_batch_atomic both find "this batch's leads"
    // through this column.
    const { error: tagError } = await supabase
      .from("leads")
      .update({ csv_import_batch_id: batchRow.id })
      .in("id", insertedLeads.map((l) => l.id));

    if (tagError) {
      return respond({ success: false, step: "TAG_LEADS_WITH_BATCH", error: tagError.message }, 500);
    }

    // --- Distribution pass ---
    const inputs = await fetchDistributionInputs(supabase);

    if (inputs.error) {
      return respond({
        success: true,
        batchId: batchRow.id,
        totalRows: rows.length,
        duplicateCount,
        importedCount: insertedLeads.length,
        assignedCount: 0,
        distributionSummary: {},
        warning: `${inputs.error} — leads imported but not distributed`
      });
    }

    const { assignedCount, distributionSummary, diagnostics } = await distributeLeadsBatch(
      supabase,
      insertedLeads,
      inputs.settings,
      inputs.projectRules,
      inputs.eligibleEmployees,
      inputs.projectPointers
    );

    await supabase
      .from("csv_import_batches")
      .update({ assigned_count: assignedCount, distribution_summary: distributionSummary })
      .eq("id", batchRow.id);

    return respond({
      success: true,
      batchId: batchRow.id,
      totalRows: rows.length,
      duplicateCount,
      importedCount: insertedLeads.length,
      assignedCount,
      distributionSummary,
      diagnostics
    });

  } catch (err) {

    return respond({ success: false, error: err.message }, 500);

  }
});
