// @ts-nocheck

import { calculateLeadAssignment } from "../../../lib/calculateLeadAssignment.ts";

// Shared by import-leads-csv and retry-lead-distribution — one
// implementation of "given a settings/rules/eligible-employees
// snapshot, distribute this list of unassigned leads," so the two
// callers can never drift on how this actually works. Same
// fetch-once-then-loop-with-an-in-memory-pointer shape recycle-stale-
// leads already established — now threading TWO pointers through the
// loop (the company-wide one, and an in-memory map of per-project
// pointers for multi-employee project rules), not just one.

export async function fetchDistributionInputs(supabase) {

  const { data: settings, error: settingsError } = await supabase
    .from("lead_engine_settings")
    .select("*")
    .eq("id", 1)
    .single();

  if (settingsError || !settings) {
    return { error: "lead_engine_settings row not found" };
  }

  // employees(is_active) joined so calculateLeadAssignment's
  // multi-employee Project Rule branch can skip a deactivated
  // member's turn in rotation without a second round-trip.
  const { data: projectRulesRaw } = await supabase
    .from("project_assignment_rules")
    .select("project, assigned_employee_id, employees(is_active)")
    .order("id", { ascending: true });

  const projectRules = (projectRulesRaw || []).map((row) => ({
    project: row.project,
    assigned_employee_id: row.assigned_employee_id,
    employee_is_active: row.employees?.is_active ?? false
  }));

  const { data: projectPointerRows } = await supabase
    .from("project_rule_pointers")
    .select("project, last_assigned_employee_id");

  const projectPointers = {};
  (projectPointerRows || []).forEach((row) => {
    projectPointers[row.project] = row.last_assigned_employee_id;
  });

  const today = new Date().toISOString().split("T")[0];

  const { data: todaysAttendance } = await supabase
    .from("attendance")
    .select("employee_id")
    .eq("date", today)
    .is("shift_end_at", null);

  const shiftStartedEmployeeIds = new Set((todaysAttendance || []).map((row) => row.employee_id));

  const { data: allEligibleEmployees } = await supabase
    .from("employees")
    .select("id")
    .eq("is_active", true)
    .eq("rr_eligible", true)
    .order("id", { ascending: true });

  const eligibleEmployees = (allEligibleEmployees || []).filter((e) =>
    shiftStartedEmployeeIds.has(e.id)
  );

  return { settings, projectRules, eligibleEmployees, projectPointers };
}

// Callers own fetching the leads list and writing back whatever
// batch/summary counters they track — this function only runs the
// assign loop itself and returns what happened.
//
// excludedEmployeeIds (optional, defaults to none) — a one-time,
// this-call-only exclusion from the ROUND-ROBIN pool, e.g. CSV
// Import's "Exclude from this distribution" picker. It is NOT a
// standing pause (that's a separate, not-yet-built feature) and is
// never persisted here — it only narrows the `eligibleEmployees` list
// passed into calculateLeadAssignment for the duration of this one
// loop. Deliberately does NOT touch Project Rules (fixed-employee-
// per-project) assignments: calculateLeadAssignment's PROJECT_RULE
// branch never consults eligibleEmployees at all, so an excluded
// employee who is also a project's fixed employee still receives that
// project's leads — same as how rr_eligible/shift-status already
// never affects a project rule today. Pointer continuity needs no
// special handling either: nextGlobalPointerEmployeeId is only ever
// drawn from the (already-filtered) pool, so lead_engine_settings
// ends this batch pointing at a non-excluded employee, and the next
// unrelated call (which won't pass excludedEmployeeIds) resumes fair
// rotation across everyone automatically.
export async function distributeLeadsBatch(supabase, leadsToDistribute, settings, projectRules, eligibleEmployees, projectPointers, excludedEmployeeIds = []) {

  const pool = excludedEmployeeIds && excludedEmployeeIds.length > 0
    ? eligibleEmployees.filter((e) => !excludedEmployeeIds.includes(e.id))
    : eligibleEmployees;

  let pointerEmployeeId = settings.round_robin_pointer_employee_id;
  const workingProjectPointers = { ...(projectPointers || {}) };
  const distributionSummary = {};
  let assignedCount = 0;
  const diagnostics = [];

  for (const lead of leadsToDistribute) {

    const result = calculateLeadAssignment(
      lead.project,
      projectRules || [],
      pool,
      pointerEmployeeId,
      workingProjectPointers
    );

    if (!result.assignedEmployeeId) {
      diagnostics.push({ leadId: lead.id, action: "SKIPPED", reason: result.reason });
      continue;
    }

    const slaDeadline = new Date(
      Date.now() + settings.sla_first_contact_minutes * 60 * 1000
    ).toISOString();

    const { error: assignError } = await supabase.rpc("assign_lead_atomic", {
      p_lead_id: lead.id,
      p_employee_id: result.assignedEmployeeId,
      p_sla_deadline: slaDeadline,
      p_next_pointer_employee_id: result.nextGlobalPointerEmployeeId
    });

    if (assignError) {
      diagnostics.push({ leadId: lead.id, action: "ASSIGN_FAILED", error: assignError.message });
      continue;
    }

    assignedCount++;
    pointerEmployeeId = result.nextGlobalPointerEmployeeId;
    distributionSummary[result.assignedEmployeeId] =
      (distributionSummary[result.assignedEmployeeId] || 0) + 1;

    if (result.nextProjectPointer) {
      // Updated in-memory FIRST so the next lead in this same loop
      // (if it hits the same project rule) sees the rotation — then
      // persisted. A failed persist here doesn't fail the lead's own
      // assignment (already committed via assign_lead_atomic above);
      // worst case, the next multi-employee-project-rule lead in a
      // FUTURE batch repeats an employee instead of rotating.
      workingProjectPointers[result.nextProjectPointer.project] = result.nextProjectPointer.employeeId;

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

  }

  return { assignedCount, distributionSummary, diagnostics };
}

// Data-type distribution — Admin has manually picked one or more
// specific employees at CSV-import time (import-leads-csv's DATA
// branch). Deliberately bypasses round robin AND Project Rules
// entirely (this is an explicit Admin override, same "authoritative
// choice" precedent Project Rules themselves already established),
// and bypasses is_active/rr_eligible/shift-started too — Admin's pick
// is trusted regardless of current eligibility, per the approved
// design. No SLA (p_sla_deadline always null — Data leads recycle on
// attempt-count, not time, see calculateSLAStatus) and always
// attributed to the calling Admin (assigned_by_type='ADMIN'), so the
// audit trail correctly shows this was a deliberate manual pick, not
// a system decision.
//
// No fairness-pointer is persisted across separate imports — each
// call just rotates evenly through manualEmployeeIds for the rows in
// THIS batch (lead[i] -> manualEmployeeIds[i % length]), starting
// fresh at index 0 every time. Data's distribution has no stated
// cross-import fairness requirement (unlike the company-wide/project-
// rule pointers, which explicitly do), so no extra pointer table is
// needed for it.
//
// currentPointerEmployeeId must be the caller's CURRENT (unchanged)
// lead_engine_settings.round_robin_pointer_employee_id — passed
// straight through to assign_lead_atomic on every call so the
// company-wide pointer is left exactly where it was. This lead was
// never part of that rotation to begin with, same "pass through
// unchanged" rule PROJECT_RULE assignments already follow.
export async function distributeDataLeadsManually(supabase, leadsToDistribute, manualEmployeeIds, adminEmployeeId, currentPointerEmployeeId) {

  const distributionSummary = {};
  let assignedCount = 0;
  const diagnostics = [];

  for (let i = 0; i < leadsToDistribute.length; i++) {

    const lead = leadsToDistribute[i];
    const employeeId = manualEmployeeIds[i % manualEmployeeIds.length];

    const { error: assignError } = await supabase.rpc("assign_lead_atomic", {
      p_lead_id: lead.id,
      p_employee_id: employeeId,
      p_sla_deadline: null,
      p_next_pointer_employee_id: currentPointerEmployeeId,
      p_assigned_by_type: "ADMIN",
      p_assigned_by_employee_id: adminEmployeeId
    });

    if (assignError) {
      diagnostics.push({ leadId: lead.id, action: "ASSIGN_FAILED", error: assignError.message });
      continue;
    }

    assignedCount++;
    distributionSummary[employeeId] = (distributionSummary[employeeId] || 0) + 1;

  }

  return { assignedCount, distributionSummary, diagnostics };
}
