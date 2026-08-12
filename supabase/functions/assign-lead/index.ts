// @ts-nocheck

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.0";
import { calculateLeadAssignment } from "../../../lib/calculateLeadAssignment.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Assigns ONE new lead — Project Rules override, else Round Robin.
// The actual decision (who gets it, where the pointer moves next) is
// owned entirely by lib/calculateLeadAssignment.ts, imported here so
// there is exactly one implementation of that logic, not two. This
// function's job is only reads/writes around that decision: fetch
// inputs, apply the result, done. Recycling stale leads is a separate
// Edge Function (recycle-stale-leads, Phase 4) — this one only ever
// runs once per brand-new lead, right after it's created.
//
// Whichever caller eventually invokes this (CSV import, admin "add
// lead" UI) must send the logged-in user's Supabase session access
// token as `Authorization: Bearer <token>` — this project has JWT
// verification enabled on Edge Functions, so a request without it
// fails with "Missing authorization header" before this code even
// runs. See components/StartShiftCard.tsx for the working pattern
// (supabase.auth.getSession() -> session.access_token).

function respond(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

serve(async (req) => {

  // Preflight — must be answered before anything else, and before
  // touching req.json() (an OPTIONS request has no body).
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {

    const { lead_id } = await req.json();

    if (!lead_id) {
      return respond(
        {
          success: false,
          message: "lead_id is required"
        },
        400
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("*")
      .eq("id", lead_id)
      .single();

    if (leadError || !lead) {
      return respond(
        {
          success: false,
          message: "Lead not found"
        },
        404
      );
    }

    // employees(is_active) joined so calculateLeadAssignment's
    // multi-employee Project Rule branch can skip a deactivated
    // member's turn in rotation without a second round-trip.
    const { data: projectRulesRaw, error: rulesError } = await supabase
      .from("project_assignment_rules")
      .select("project, assigned_employee_id, employees(is_active)")
      .order("id", { ascending: true });

    if (rulesError) {
      return respond(
        {
          success: false,
          step: "FETCH_PROJECT_RULES",
          error: rulesError.message
        },
        500
      );
    }

    const projectRules = (projectRulesRaw || []).map((row) => ({
      project: row.project,
      assigned_employee_id: row.assigned_employee_id,
      employee_is_active: row.employees?.is_active ?? false
    }));

    const { data: projectPointerRows, error: pointerError } = await supabase
      .from("project_rule_pointers")
      .select("project, last_assigned_employee_id");

    if (pointerError) {
      return respond(
        {
          success: false,
          step: "FETCH_PROJECT_POINTERS",
          error: pointerError.message
        },
        500
      );
    }

    const projectPointers = {};
    (projectPointerRows || []).forEach((row) => {
      projectPointers[row.project] = row.last_assigned_employee_id;
    });

    // "This employee should never get round-robin leads for this
    // project" — the opposite of project_assignment_rules, only ever
    // consulted by calculateLeadAssignment when NO include-rule
    // matches the project.
    const { data: projectExclusions, error: exclusionsError } = await supabase
      .from("project_exclusion_rules")
      .select("project, excluded_employee_id");

    if (exclusionsError) {
      return respond(
        {
          success: false,
          step: "FETCH_PROJECT_EXCLUSIONS",
          error: exclusionsError.message
        },
        500
      );
    }

    // Round-robin pool = active + rr_eligible employees who have
    // started today's shift AND not yet ended it (Phase 2 attendance
    // gate). Ending shift re-locks new lead assignment for the rest
    // of the day, same logic as never having started. This is the
    // only place the gate applies — it never affects V1 post access
    // or an employee's ability to view/update leads they already own
    // (lib/calculateLeadAssignment.ts and the leads/lead_history RLS
    // policies never reference attendance at all).
    const today = new Date().toISOString().split("T")[0];

    const { data: todaysAttendance, error: attendanceError } = await supabase
      .from("attendance")
      .select("employee_id")
      .eq("date", today)
      .is("shift_end_at", null);

    if (attendanceError) {
      return respond(
        {
          success: false,
          step: "FETCH_TODAYS_ATTENDANCE",
          error: attendanceError.message
        },
        500
      );
    }

    const shiftStartedEmployeeIds = new Set(
      (todaysAttendance || []).map((row) => row.employee_id)
    );

    const { data: allEligibleEmployees, error: employeesError } = await supabase
      .from("employees")
      .select("id")
      .eq("is_active", true)
      .eq("rr_eligible", true)
      .order("id", { ascending: true });

    if (employeesError) {
      return respond(
        {
          success: false,
          step: "FETCH_ELIGIBLE_EMPLOYEES",
          error: employeesError.message
        },
        500
      );
    }

    // filter() preserves the id-ascending order from the query above,
    // so the stable ordering calculateLeadAssignment depends on holds.
    const eligibleEmployees = (allEligibleEmployees || []).filter(
      (employee) => shiftStartedEmployeeIds.has(employee.id)
    );

    const { data: settings, error: settingsError } = await supabase
      .from("lead_engine_settings")
      .select("*")
      .eq("id", 1)
      .single();

    if (settingsError || !settings) {
      return respond(
        {
          success: false,
          message: "lead_engine_settings row not found"
        },
        500
      );
    }

    const result = calculateLeadAssignment(
      lead.project,
      projectRules || [],
      eligibleEmployees || [],
      settings.round_robin_pointer_employee_id,
      projectPointers,
      projectExclusions || []
    );

    if (!result.assignedEmployeeId) {
      // Nothing eligible right now — leave the lead untouched rather
      // than writing a partial/incorrect assignment. Admin needs to
      // handle this manually (e.g. no one is rr_eligible yet today).
      return respond({
        success: false,
        reason: result.reason,
        message: "No eligible employee available to assign this lead"
      });
    }

    // SLA clock starts at the moment of assignment (Section 4.4:
    // "2 hours to first contact") — assign_lead_atomic is the sole
    // owner of computing AND setting sla_deadline now (working-hours-
    // aware, via compute_working_hours_sla_deadline), since it's the
    // event that starts it. This Edge Function doesn't compute it at
    // all anymore — passing a naive Date.now()-based value here would
    // just be a second, driftable copy of the same decision.
    //
    // The 3 writes (leads update, lead_history insert, pointer
    // update) happen inside one Postgres function call so they are
    // atomic — if any step fails, everything rolls back instead of
    // leaving a lead half-assigned. See assign_lead_atomic in the
    // DB (SQL provided separately) for the transaction itself; this
    // Edge Function never writes to these tables directly.
    const { error: assignError } = await supabase.rpc("assign_lead_atomic", {
      p_lead_id: lead_id,
      p_employee_id: result.assignedEmployeeId,
      p_next_pointer_employee_id: result.nextGlobalPointerEmployeeId
    });

    if (assignError) {
      return respond(
        {
          success: false,
          step: "ASSIGN_LEAD_ATOMIC",
          error: assignError.message
        },
        500
      );
    }

    // Non-fatal if this fails — the lead is already correctly
    // assigned via assign_lead_atomic above. Losing this write just
    // means the next multi-employee-project-rule lead for this
    // project might repeat the same employee instead of rotating.
    if (result.nextProjectPointer) {
      const { error: projectPointerError } = await supabase
        .from("project_rule_pointers")
        .upsert({
          project: result.nextProjectPointer.project,
          last_assigned_employee_id: result.nextProjectPointer.employeeId
        });

      if (projectPointerError) {
        console.error("project_rule_pointers upsert failed:", projectPointerError.message);
      }
    }

    return respond({
      success: true,
      assignedEmployeeId: result.assignedEmployeeId,
      reason: result.reason
    });

  } catch (err) {

    console.error("assign-lead: unhandled error:", err.message, err.stack);

    return respond(
      {
        success: false,
        error: err.message
      },
      500
    );

  }
});
