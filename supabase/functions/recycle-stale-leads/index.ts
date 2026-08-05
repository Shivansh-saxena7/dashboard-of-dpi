// @ts-nocheck

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.0";
import { calculateSLAStatus } from "../../../lib/calculateSLAStatus.ts";
import { calculateLeadAssignment } from "../../../lib/calculateLeadAssignment.ts";

// Scheduled sweep (pg_cron, every 15 min — modeled on
// mark-missed-posts). No CORS, no caller-identity resolution: this
// is a system job, never invoked from the browser, same posture as
// mark-missed-posts itself.
//
// For each non-terminal lead (has an active lead_history row):
//   - JUNK_ELIGIBLE (max recycles OR repeat NOT_INTERESTED — either
//     trigger, regardless of Project Rule status) -> mark_lead_junk_atomic.
//   - SLA_BREACHED / RECYCLE_READY on a Project-Rule lead -> a single
//     SLA_WARNING notification to that fixed employee; ownership
//     never changes, since Project Rules are a hard override (per
//     the approved design) — guarded by lead_history.sla_warning_sent_at
//     so this never repeats for the same assignment.
//   - SLA_BREACHED / RECYCLE_READY on everything else -> reassign via
//     calculateLeadAssignment (current owner excluded from the
//     eligible pool, so a non-responsive employee doesn't just get
//     the same lead back) + recycle_lead_atomic.
//
// pointerEmployeeId is threaded through the loop in memory (not
// re-read from settings per lead), so multiple recycles within the
// same sweep run correctly advance round robin instead of all
// landing on the same "next" employee computed from a now-stale
// value. This assumes sweeps don't overlap (15-min schedule, runs
// should finish well under that) — no extra locking added for that.
//
// diagnostics[] records exactly what happened (or didn't) for every
// lead checked, including RPC failures that would otherwise be
// silently swallowed by a bare `continue`. Always included in the
// response, not just on error — this was added after the first real
// debugging session showed "succeeded" cron status is not enough to
// tell whether anything meaningful happened.

serve(async () => {
  try {

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: settings, error: settingsError } = await supabase
      .from("lead_engine_settings")
      .select("*")
      .eq("id", 1)
      .single();

    if (settingsError || !settings) {
      return new Response(
        JSON.stringify({ success: false, message: "lead_engine_settings row not found" }),
        { headers: { "Content-Type": "application/json" }, status: 500 }
      );
    }

    const { data: projectRules, error: rulesError } = await supabase
      .from("project_assignment_rules")
      .select("project, assigned_employee_id");

    if (rulesError) {
      return new Response(
        JSON.stringify({ success: false, step: "FETCH_PROJECT_RULES", error: rulesError.message }),
        { headers: { "Content-Type": "application/json" }, status: 500 }
      );
    }

    // For multi-employee project rules — round robin position within
    // just that project's fixed-employee group, entirely separate
    // from the company-wide pointer.
    const { data: projectPointerRows, error: projectPointerError } = await supabase
      .from("project_rule_pointers")
      .select("project, last_assigned_employee_id");

    if (projectPointerError) {
      return new Response(
        JSON.stringify({ success: false, step: "FETCH_PROJECT_POINTERS", error: projectPointerError.message }),
        { headers: { "Content-Type": "application/json" }, status: 500 }
      );
    }

    const projectPointers: Record<string, string | null> = {};
    (projectPointerRows || []).forEach((row) => {
      projectPointers[row.project] = row.last_assigned_employee_id;
    });

    const today = new Date().toISOString().split("T")[0];

    const { data: todaysAttendance, error: attendanceError } = await supabase
      .from("attendance")
      .select("employee_id")
      .eq("date", today)
      .is("shift_end_at", null);

    if (attendanceError) {
      return new Response(
        JSON.stringify({ success: false, step: "FETCH_TODAYS_ATTENDANCE", error: attendanceError.message }),
        { headers: { "Content-Type": "application/json" }, status: 500 }
      );
    }

    const shiftStartedEmployeeIds = new Set((todaysAttendance || []).map((row) => row.employee_id));

    const { data: allActiveEmployees, error: employeesError } = await supabase
      .from("employees")
      .select("id, team_id")
      .eq("is_active", true)
      .eq("rr_eligible", true)
      .order("id", { ascending: true });

    if (employeesError) {
      return new Response(
        JSON.stringify({ success: false, step: "FETCH_ELIGIBLE_EMPLOYEES", error: employeesError.message }),
        { headers: { "Content-Type": "application/json" }, status: 500 }
      );
    }

    const shiftActiveEmployees = (allActiveEmployees || []).filter((employee) =>
      shiftStartedEmployeeIds.has(employee.id)
    );

    // Team-scoping lookup for recycling a Team-Leader-assigned lead
    // (see below): keyed by the CURRENT OWNER's team, not the
    // assigner's — the assigner could change teams later, but the
    // current owner's team is what "this lead belongs to this team's
    // pool" actually means at recycle time. A separate, unfiltered
    // fetch because the current owner themselves might not be
    // is_active/rr_eligible/shift-started (and so wouldn't appear in
    // allActiveEmployees at all), but we still need to know their
    // team to scope the pool correctly.
    const { data: allEmployeesForTeamLookup, error: teamLookupError } = await supabase
      .from("employees")
      .select("id, team_id");

    if (teamLookupError) {
      return new Response(
        JSON.stringify({ success: false, step: "FETCH_TEAM_LOOKUP", error: teamLookupError.message }),
        { headers: { "Content-Type": "application/json" }, status: 500 }
      );
    }

    const teamIdByEmployeeId = new Map<string, string | null>();
    (allEmployeesForTeamLookup || []).forEach((e) => teamIdByEmployeeId.set(e.id, e.team_id));

    const { data: leads, error: leadsError } = await supabase
      .from("leads")
      .select(
        `
        id,
        project,
        status,
        sla_deadline,
        recycle_count,
        current_owner_id,
        lead_type,
        lead_history!inner (
          id,
          outcome_at,
          is_active,
          sla_warning_sent_at,
          assigned_by_type,
          call_count
        )
      `
      )
      .not("status", "in", "(CONVERTED,JUNK)")
      .eq("lead_history.is_active", true);

    if (leadsError) {
      return new Response(
        JSON.stringify({ success: false, step: "FETCH_LEADS", error: leadsError.message }),
        { headers: { "Content-Type": "application/json" }, status: 500 }
      );
    }

    let recycledCount = 0;
    let junkedCount = 0;
    let warnedCount = 0;
    let pointerEmployeeId = settings.round_robin_pointer_employee_id;
    const diagnostics: any[] = [];

    for (const lead of leads || []) {

      const activeHistory = lead.lead_history[0];

      if (!activeHistory) {
        diagnostics.push({ leadId: lead.id, action: "SKIPPED", reason: "no active lead_history row" });
        continue;
      }

      const { count: notInterestedCount } = await supabase
        .from("lead_history")
        .select("*", { count: "exact", head: true })
        .eq("lead_id", lead.id)
        .eq("outcome", "NOT_INTERESTED");

      const slaStatus = calculateSLAStatus(
        {
          status: lead.status,
          sla_deadline: lead.sla_deadline,
          recycle_count: lead.recycle_count,
          lead_type: lead.lead_type,
          call_count: activeHistory.call_count
        },
        activeHistory.outcome_at,
        notInterestedCount || 0
      );

      if (slaStatus === "JUNK_ELIGIBLE") {

        const { error: junkError } = await supabase.rpc("mark_lead_junk_atomic", {
          p_lead_id: lead.id,
          p_lead_history_id: activeHistory.id,
          p_reason: lead.recycle_count >= 3 ? "max recycles reached" : "repeat NOT_INTERESTED"
        });

        if (junkError) {
          diagnostics.push({
            leadId: lead.id,
            action: "JUNK_FAILED",
            slaStatus,
            notInterestedCount: notInterestedCount || 0,
            error: junkError.message
          });
        } else {
          junkedCount++;
          diagnostics.push({
            leadId: lead.id,
            action: "JUNKED",
            slaStatus,
            notInterestedCount: notInterestedCount || 0
          });
        }

        continue;

      }

      if (
        slaStatus !== "SLA_BREACHED" &&
        slaStatus !== "RECYCLE_READY" &&
        slaStatus !== "DATA_MAX_ATTEMPTS_REACHED"
      ) {
        diagnostics.push({ leadId: lead.id, action: "SKIPPED", reason: `slaStatus=${slaStatus}` });
        continue;
      }

      // DATA leads carry no SLA-clock at all — even after this
      // recycle lands them with a new owner, per the approved design
      // they stay attempt-count-based (not time-based) for as long as
      // they remain unreached, so the new lead_history row should
      // start with no sla_deadline too, same as their very first
      // assignment did.
      const isDataLead = lead.lead_type === "DATA";

      const normalizedProject = String(lead.project || "").trim().toLowerCase();

      const allMatchedEmployeeIds = Array.from(
        new Set(
          (projectRules || [])
            .filter((rule) => String(rule.project || "").trim().toLowerCase() === normalizedProject)
            .map((rule) => rule.assigned_employee_id)
        )
      );

      if (allMatchedEmployeeIds.length === 1) {

        // Single fixed employee — hard override, never reassigned
        // away, unchanged from the original design. Escalate once,
        // never repeat for this same assignment. Notifies
        // lead.current_owner_id (not the rule row's employee id
        // directly) — in this single-employee case they're always the
        // same in practice, but this is the actually-correct signal:
        // whoever currently holds the lead is who needs the nudge.
        if (!activeHistory.sla_warning_sent_at) {

          await supabase
            .from("lead_history")
            .update({ sla_warning_sent_at: new Date().toISOString() })
            .eq("id", activeHistory.id);

          const { data: employee } = await supabase
            .from("employees")
            .select("name")
            .eq("id", lead.current_owner_id)
            .single();

          await supabase.from("notification").insert({
            employee_id: lead.current_owner_id,
            employee_name: employee?.name || "",
            title: "Lead needs follow-up",
            message: "A lead assigned to you via a Project Rule is past its SLA window — please follow up.",
            type: "SLA_WARNING",
            is_read: false
          });

          warnedCount++;
          diagnostics.push({ leadId: lead.id, action: "WARNED", slaStatus, project: lead.project });

        } else {
          diagnostics.push({ leadId: lead.id, action: "SKIPPED", reason: "project rule, already warned" });
        }

        continue;

      }

      if (allMatchedEmployeeIds.length > 1) {

        // Multiple fixed employees for this project — SLA breach
        // rotates within just this group (current/non-responsive
        // owner excluded, and only currently shift-active members
        // considered — a project rule bypasses the rr_eligible pool
        // gate entirely by design, but someone who hasn't clocked in
        // still can't realistically respond right now). Never escapes
        // to the system-wide pool. Mirrors team-scoped recycling's
        // shape exactly.
        const groupPoolEmployees = allMatchedEmployeeIds.filter(
          (id) => id !== lead.current_owner_id && shiftStartedEmployeeIds.has(id)
        );

        if (groupPoolEmployees.length === 0) {
          diagnostics.push({
            leadId: lead.id,
            action: "SKIPPED",
            reason: "PROJECT_RULE_GROUP_NO_ELIGIBLE_EMPLOYEE",
            slaStatus,
            project: lead.project
          });
          continue;
        }

        const lastProjectPointer = projectPointers[normalizedProject] ?? null;
        const lastIndex = groupPoolEmployees.findIndex((id) => id === lastProjectPointer);
        const nextIndex = lastIndex === -1 ? 0 : (lastIndex + 1) % groupPoolEmployees.length;
        const nextEmployeeId = groupPoolEmployees[nextIndex];

        const newSlaDeadline = isDataLead
          ? null
          : new Date(Date.now() + settings.sla_first_contact_minutes * 60 * 1000).toISOString();

        const { error: projectRecycleError } = await supabase.rpc("recycle_lead_atomic", {
          p_lead_id: lead.id,
          p_old_lead_history_id: activeHistory.id,
          p_new_employee_id: nextEmployeeId,
          p_new_sla_deadline: newSlaDeadline,
          // Global pointer untouched — this lead was never part of the
          // company-wide rotation to begin with.
          p_next_pointer_employee_id: pointerEmployeeId,
          p_recycle_reason: slaStatus
        });

        if (projectRecycleError) {
          diagnostics.push({
            leadId: lead.id,
            action: "RECYCLE_FAILED",
            slaStatus,
            assignedEmployeeId: nextEmployeeId,
            error: projectRecycleError.message
          });
        } else {
          recycledCount++;
          projectPointers[normalizedProject] = nextEmployeeId;

          const { error: projectPointerUpsertError } = await supabase
            .from("project_rule_pointers")
            .upsert({ project: normalizedProject, last_assigned_employee_id: nextEmployeeId });

          if (projectPointerUpsertError) {
            console.error("project_rule_pointers upsert failed:", projectPointerUpsertError.message);
          }

          diagnostics.push({
            leadId: lead.id,
            action: "RECYCLED",
            slaStatus,
            assignedEmployeeId: nextEmployeeId,
            scope: "PROJECT_RULE_GROUP"
          });
        }

        continue;

      }

      // Round robin: exclude the current owner so a non-responsive
      // employee doesn't just get the same lead back.
      let eligibleEmployees = shiftActiveEmployees.filter(
        (employee) => employee.id !== lead.current_owner_id
      );

      // A Team-Leader-assigned lead was that team's own resource, not
      // part of the company-wide round-robin rotation to begin with —
      // recycling it stays inside the current owner's team rather
      // than falling back to the system-wide pool. If the team has
      // nobody else eligible right now, this is skipped (retried next
      // sweep) rather than silently escaping team scope.
      const isTeamLeaderAssigned = activeHistory.assigned_by_type === "TEAM_LEADER";
      let scopedTeamId: string | null = null;

      if (isTeamLeaderAssigned) {
        scopedTeamId = teamIdByEmployeeId.get(lead.current_owner_id) ?? null;

        eligibleEmployees = scopedTeamId
          ? eligibleEmployees.filter((employee) => employee.team_id === scopedTeamId)
          : [];

        if (eligibleEmployees.length === 0) {
          diagnostics.push({
            leadId: lead.id,
            action: "SKIPPED",
            reason: "TEAM_SCOPED_NO_ELIGIBLE_EMPLOYEE",
            slaStatus,
            teamId: scopedTeamId
          });
          continue;
        }
      }

      const result = calculateLeadAssignment(
        lead.project,
        [], // Project Rules already ruled out for this lead above
        eligibleEmployees,
        pointerEmployeeId
      );

      if (!result.assignedEmployeeId) {
        // Nobody eligible right now — leave it, retry next sweep.
        diagnostics.push({
          leadId: lead.id,
          action: "SKIPPED",
          reason: "NO_ELIGIBLE_EMPLOYEE",
          slaStatus,
          eligiblePoolSize: eligibleEmployees.length
        });
        continue;
      }

      const newSlaDeadline = isDataLead
        ? null
        : new Date(Date.now() + settings.sla_first_contact_minutes * 60 * 1000).toISOString();

      const { error: recycleError } = await supabase.rpc("recycle_lead_atomic", {
        p_lead_id: lead.id,
        p_old_lead_history_id: activeHistory.id,
        p_new_employee_id: result.assignedEmployeeId,
        p_new_sla_deadline: newSlaDeadline,
        // Team-scoped recycles never advance the system-wide pointer
        // — that pointer tracks company-wide rotation, which this
        // lead was never part of (same "bypasses round-robin"
        // principle the manual-assign/reassign RPCs follow).
        p_next_pointer_employee_id: isTeamLeaderAssigned ? pointerEmployeeId : result.nextGlobalPointerEmployeeId,
        p_recycle_reason: slaStatus
      });

      if (recycleError) {
        diagnostics.push({
          leadId: lead.id,
          action: "RECYCLE_FAILED",
          slaStatus,
          assignedEmployeeId: result.assignedEmployeeId,
          error: recycleError.message
        });
      } else {
        recycledCount++;
        if (!isTeamLeaderAssigned) {
          pointerEmployeeId = result.nextGlobalPointerEmployeeId;
        }
        diagnostics.push({
          leadId: lead.id,
          action: "RECYCLED",
          slaStatus,
          assignedEmployeeId: result.assignedEmployeeId,
          scope: isTeamLeaderAssigned ? "TEAM" : "SYSTEM_WIDE"
        });
      }

    }

    return new Response(
      JSON.stringify({
        success: true,
        recycledCount,
        junkedCount,
        warnedCount,
        totalChecked: (leads || []).length,
        diagnostics
      }),
      { headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {

    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { headers: { "Content-Type": "application/json" }, status: 500 }
    );

  }
});
