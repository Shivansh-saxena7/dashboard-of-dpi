// Single source of truth for "who gets this lead" — Project Rules
// override first, then Round Robin. Same pattern as
// components/calculateStatus.ts: pure function, deterministic,
// no DB access. The Edge Function that wires this to Supabase
// (assign-lead, following the update-tracking-status /
// mark-missed-posts pattern) owns the actual reads/writes.

export type LeadAssignmentReason =
  | "PROJECT_RULE"
  | "ROUND_ROBIN"
  | "NO_ELIGIBLE_EMPLOYEE";

export interface ProjectAssignmentRule {
  project: string;
  assigned_employee_id: string;
}

export interface EligibleEmployee {
  id: string;
}

// project -> last-assigned-employee-id within that project's own
// fixed-employee pool. Keyed by the SAME normalization this function
// applies internally (trim + lowercase) — callers read/write
// project_rule_pointers using whatever key calculateLeadAssignment
// hands back in nextProjectPointer.project, so they never need to
// normalize independently.
export type ProjectRulePointers = Record<string, string | null>;

export interface LeadAssignmentResult {
  assignedEmployeeId: string | null;
  reason: LeadAssignmentReason;
  // lead_engine_settings.round_robin_pointer_employee_id — only
  // actually moves on ROUND_ROBIN. PROJECT_RULE and
  // NO_ELIGIBLE_EMPLOYEE both pass the input value straight through,
  // so writing this back is always safe, even when nothing changed.
  nextGlobalPointerEmployeeId: string | null;
  // Present only when this was a PROJECT_RULE match against a project
  // with MORE than one fixed employee — the caller persists this into
  // project_rule_pointers. Null for a single-employee project rule
  // (nothing to rotate) and for ROUND_ROBIN/NO_ELIGIBLE_EMPLOYEE.
  nextProjectPointer: { project: string; employeeId: string } | null;
}

// `eligibleEmployees` must already be filtered by the caller to
// employees where is_active = true, rr_eligible = true, and shift
// started today — this function only decides ordering/turn-taking
// within that pool. The list must be in a stable, consistent order
// every time it's built (e.g. sorted by id), since round robin
// depends on that order. Same stability requirement applies to a
// project's matched-employee list, which is derived here from
// projectRules in whatever order those rows were fetched in — callers
// should fetch project_assignment_rules with a stable order (e.g. by
// id) for the multi-employee rotation to behave predictably.
export function calculateLeadAssignment(
  project: string | null,
  projectRules: ProjectAssignmentRule[],
  eligibleEmployees: EligibleEmployee[],
  lastGlobalAssignedEmployeeId: string | null,
  projectPointers: ProjectRulePointers = {}
): LeadAssignmentResult {

  const normalizedProject = String(project || "").trim().toLowerCase();

  if (normalizedProject) {

    const matchedEmployeeIds = Array.from(
      new Set(
        projectRules
          .filter((rule) => String(rule.project || "").trim().toLowerCase() === normalizedProject)
          .map((rule) => rule.assigned_employee_id)
      )
    );

    if (matchedEmployeeIds.length === 1) {
      // Single fixed employee — bypasses round robin entirely, pointer
      // left untouched so the company-wide pool's turn order stays
      // fair. If the rule's employee is later deactivated, the rule
      // itself must be updated/removed — this function does not fall
      // back to round robin automatically.
      return {
        assignedEmployeeId: matchedEmployeeIds[0],
        reason: "PROJECT_RULE",
        nextGlobalPointerEmployeeId: lastGlobalAssignedEmployeeId,
        nextProjectPointer: null
      };
    }

    if (matchedEmployeeIds.length > 1) {
      // Multiple fixed employees for this project — round robin among
      // just this group, using a pointer scoped to the project itself,
      // never the company-wide one. Still bypasses the general pool
      // entirely, same as the single-employee case.
      const lastProjectPointer = projectPointers[normalizedProject] ?? null;
      const lastIndex = matchedEmployeeIds.findIndex((id) => id === lastProjectPointer);
      const nextIndex = lastIndex === -1 ? 0 : (lastIndex + 1) % matchedEmployeeIds.length;
      const nextEmployeeId = matchedEmployeeIds[nextIndex];

      return {
        assignedEmployeeId: nextEmployeeId,
        reason: "PROJECT_RULE",
        nextGlobalPointerEmployeeId: lastGlobalAssignedEmployeeId,
        nextProjectPointer: { project: normalizedProject, employeeId: nextEmployeeId }
      };
    }

  }

  if (eligibleEmployees.length === 0) {
    return {
      assignedEmployeeId: null,
      reason: "NO_ELIGIBLE_EMPLOYEE",
      nextGlobalPointerEmployeeId: lastGlobalAssignedEmployeeId,
      nextProjectPointer: null
    };
  }

  const lastIndex = eligibleEmployees.findIndex(
    (employee) => employee.id === lastGlobalAssignedEmployeeId
  );

  const nextIndex = lastIndex === -1 ? 0 : (lastIndex + 1) % eligibleEmployees.length;

  const nextEmployee = eligibleEmployees[nextIndex];

  return {
    assignedEmployeeId: nextEmployee.id,
    reason: "ROUND_ROBIN",
    nextGlobalPointerEmployeeId: nextEmployee.id,
    nextProjectPointer: null
  };

}
