// @ts-nocheck

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.0";
import { normalizeMobile } from "../../../lib/normalizeMobile.ts";
import { normalizeLeadPriority } from "../../../lib/normalizeLeadPriority.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveCallingEmployeeId } from "../_shared/auth.ts";
import { fetchDistributionInputs, distributeLeadsBatch, distributeDataLeadsManually } from "../_shared/distributeLeads.ts";

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

    const {
      rows,
      source_name,
      filename,
      target_team_id,
      excluded_employee_ids,
      lead_type,
      manual_employee_ids
    } = await req.json();

    // Defensive normalize — only ever consulted for AUTO-mode
    // distribution below; irrelevant (and ignored) for target_team_id
    // imports, which bypass round robin entirely already.
    const excludedEmployeeIds = Array.isArray(excluded_employee_ids)
      ? excluded_employee_ids.filter((id) => typeof id === "string")
      : [];

    // Defaults to "LEAD" for any caller that omits it (there's only
    // one caller today — the import wizard — but this keeps the
    // pre-Data behavior as the fallback rather than requiring every
    // request to specify it).
    const leadType = lead_type === "DATA" ? "DATA" : "LEAD";

    const manualEmployeeIds = Array.isArray(manual_employee_ids)
      ? manual_employee_ids.filter((id) => typeof id === "string")
      : [];

    console.log("import-leads-csv: request received", {
      rowCount: Array.isArray(rows) ? rows.length : 0,
      sourceName: source_name,
      leadType,
      hasTargetTeam: Boolean(target_team_id),
      manualEmployeeCount: manualEmployeeIds.length,
      excludedEmployeeCount: excludedEmployeeIds.length
    });

    if (!Array.isArray(rows) || rows.length === 0) {
      return respond({ success: false, message: "No rows to import" }, 400);
    }

    if (!source_name) {
      return respond({ success: false, message: "source_name is required" }, 400);
    }

    // Data always distributes via an explicit Admin pick, never round
    // robin/a team reservation — same authoritative-check posture as
    // the Admin-role check above (client-side validation could be
    // stale or bypassed, this is what's actually enforced).
    if (leadType === "DATA" && manualEmployeeIds.length === 0) {
      return respond({ success: false, message: "Select at least one employee for a Data import" }, 400);
    }

    // --- Server-side duplicate re-check (defense-in-depth — the
    // client-side preview could be stale by the time this runs) ---
    //
    // Data's duplicate-check is scoped to the employee(s) THIS batch
    // targets, not global — the same number can go to multiple
    // employees across separate imports (e.g. re-uploading the same
    // CSV for a different employee), as long as neither of them
    // already has it. "already has it" means current_owner_id, not
    // status — a Data lead that's since recycled away from someone
    // updates current_owner_id off them, so they're correctly no
    // longer blocked from receiving that number again. Leads keep the
    // original global check, completely unaffected.
    let existingLeadsQuery = supabase.from("leads").select("mobile");

    if (leadType === "DATA") {
      existingLeadsQuery = existingLeadsQuery.eq("lead_type", "DATA").in("current_owner_id", manualEmployeeIds);
    }

    const { data: existingLeads, error: existingLeadsError } = await existingLeadsQuery;

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
        extra_data: row.extra_data || null,
        lead_type: leadType,
        // Always explicit, for BOTH types — never omitted/left to the
        // leads.priority column's own DB default again. That default
        // happens to be 'cold', which is exactly right for Data but
        // was silently making every Lead "Cold" too (a real bug this
        // fixes, not just a Data-specific rule) — a mapped CSV
        // Priority column wins if recognized (hot/warm/cold and a few
        // synonyms), otherwise Leads default to "warm" (genuinely
        // fresh, unworked leads), never "cold". Data ignores whatever
        // the CSV says here entirely — its priority is always "cold"
        // by design, regardless of any mapped column.
        priority: leadType === "DATA" ? "cold" : (normalizeLeadPriority(row.priority) || "warm")
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
        imported_count: insertedLeads.length,
        excluded_employee_ids: excludedEmployeeIds.length > 0 ? excludedEmployeeIds : null,
        lead_type: leadType
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

    console.log("import-leads-csv: leads inserted and tagged", {
      batchId: batchRow.id,
      importedCount: insertedLeads.length,
      duplicateCount
    });

    // --- Data: manual per-employee distribution. Checked before
    // target_team_id below (mutually exclusive in practice — the
    // wizard never sends both — but Data takes precedence if it ever
    // did, since it's the more specific, more recently-stated intent
    // for this batch). Bypasses round robin/Project Rules/eligibility
    // entirely, via distributeDataLeadsManually — see its own
    // comment. Needs the CURRENT round-robin pointer only to pass it
    // through unchanged (this batch was never part of that rotation).
    if (leadType === "DATA") {

      const { data: settingsRow, error: settingsError } = await supabase
        .from("lead_engine_settings")
        .select("round_robin_pointer_employee_id")
        .eq("id", 1)
        .single();

      if (settingsError || !settingsRow) {
        return respond({
          success: true,
          batchId: batchRow.id,
          totalRows: rows.length,
          duplicateCount,
          importedCount: insertedLeads.length,
          assignedCount: 0,
          distributionSummary: {},
          warning: "lead_engine_settings row not found — leads imported but not distributed"
        });
      }

      console.log("import-leads-csv: starting Data manual distribution", {
        batchId: batchRow.id,
        leadCount: insertedLeads.length,
        manualEmployeeIds
      });

      const { assignedCount, distributionSummary, diagnostics } = await distributeDataLeadsManually(
        supabase,
        insertedLeads,
        manualEmployeeIds,
        auth.employeeId,
        settingsRow.round_robin_pointer_employee_id
      );

      console.log("import-leads-csv: Data manual distribution complete", {
        batchId: batchRow.id,
        assignedCount,
        diagnostics
      });

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

    }

    // --- Direct-to-Team: reserve every inserted lead for one team
    // instead of auto-distributing. Reuses pending_team_id (the same
    // column the single-lead "Reserve for Team" button sets) and
    // lead_team_reservations (the same audit table that flow already
    // writes to) — no new schema, so each lead's own History modal
    // shows "Reserved for Team X by Admin" exactly like a manual
    // reservation would. ---
    if (target_team_id) {

      const { error: reserveError } = await supabase
        .from("leads")
        .update({ pending_team_id: target_team_id })
        .in("id", insertedLeads.map((l) => l.id));

      if (reserveError) {
        return respond({ success: false, step: "RESERVE_FOR_TEAM", error: reserveError.message }, 500);
      }

      const { error: reservationLogError } = await supabase
        .from("lead_team_reservations")
        .insert(
          insertedLeads.map((l) => ({
            lead_id: l.id,
            team_id: target_team_id,
            reserved_by_employee_id: auth.employeeId
          }))
        );

      if (reservationLogError) {
        // Non-fatal — the leads are already correctly reserved via the
        // update above; losing this insert only means those leads'
        // History modals won't show the reservation line.
        console.error("lead_team_reservations insert failed:", reservationLogError.message);
      }

      return respond({
        success: true,
        batchId: batchRow.id,
        totalRows: rows.length,
        duplicateCount,
        importedCount: insertedLeads.length,
        assignedCount: 0,
        distributionSummary: {},
        reservedForTeam: { id: target_team_id }
      });

    }

    // --- Distribution pass ---
    console.log("import-leads-csv: starting fetchDistributionInputs", { batchId: batchRow.id });

    const inputs = await fetchDistributionInputs(supabase);

    if (inputs.error) {
      console.error("import-leads-csv: fetchDistributionInputs returned an error", {
        batchId: batchRow.id,
        error: inputs.error
      });

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

    console.log("import-leads-csv: fetchDistributionInputs complete, starting distributeLeadsBatch", {
      batchId: batchRow.id,
      eligibleEmployeeCount: inputs.eligibleEmployees.length,
      projectRuleCount: inputs.projectRules.length,
      projectExclusionCount: inputs.projectExclusions.length,
      excludedEmployeeCount: excludedEmployeeIds.length
    });

    const { assignedCount, distributionSummary, diagnostics } = await distributeLeadsBatch(
      supabase,
      insertedLeads,
      inputs.settings,
      inputs.projectRules,
      inputs.eligibleEmployees,
      inputs.projectPointers,
      excludedEmployeeIds,
      inputs.projectExclusions
    );

    console.log("import-leads-csv: distributeLeadsBatch complete", {
      batchId: batchRow.id,
      assignedCount,
      distributionSummary,
      diagnostics
    });

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

    // Previously missing — any exception anywhere in this function
    // (e.g. a throw inside the distribution pass) went straight into
    // the HTTP response body with nothing printed to Runtime Logs,
    // which is exactly what made a real production failure
    // indistinguishable from "nothing happened" when checking logs
    // after the fact. err.stack (not just .message) so the actual
    // throw-site is visible, not just the error text.
    console.error("import-leads-csv: unhandled error:", err.message, err.stack);

    return respond({ success: false, error: err.message }, 500);

  }
});
