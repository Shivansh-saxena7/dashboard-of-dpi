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

  const { data: projectRules } = await supabase
    .from("project_assignment_rules")
    .select("project, assigned_employee_id")
    .order("id", { ascending: true });

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

  return { settings, projectRules: projectRules || [], eligibleEmployees, projectPointers };
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
