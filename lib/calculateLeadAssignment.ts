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

export interface LeadAssignmentResult {
  assignedEmployeeId: string | null;
  nextPointerEmployeeId: string | null;
  reason: LeadAssignmentReason;
}

// `eligibleEmployees` must already be filtered by the caller to
// employees where is_active = true, rr_eligible = true, and (once
// the attendance gate ships in Phase 2) shift started today — this
// function only decides ordering/turn-taking within that pool, per
// the boundary rule that shift status only gates NEW lead assignment.
// The list must also be in a stable, consistent order every time it's
// built (e.g. sorted by id), since round robin depends on that order.
export function calculateLeadAssignment(
  project: string | null,
  projectRules: ProjectAssignmentRule[],
  eligibleEmployees: EligibleEmployee[],
  lastAssignedEmployeeId: string | null
): LeadAssignmentResult {

  const normalizedProject = String(project || "").trim().toLowerCase();

  if (normalizedProject) {

    const matchedRule = projectRules.find(
      (rule) => String(rule.project || "").trim().toLowerCase() === normalizedProject
    );

    if (matchedRule) {
      // Project Rules override bypasses round robin entirely — the
      // pointer is left untouched so the rest of the pool's turn
      // order stays fair. If the rule's employee is later deactivated,
      // the rule itself must be updated/removed — this function does
      // not fall back to round robin automatically.
      return {
        assignedEmployeeId: matchedRule.assigned_employee_id,
        nextPointerEmployeeId: lastAssignedEmployeeId,
        reason: "PROJECT_RULE"
      };
    }

  }

  if (eligibleEmployees.length === 0) {
    return {
      assignedEmployeeId: null,
      nextPointerEmployeeId: lastAssignedEmployeeId,
      reason: "NO_ELIGIBLE_EMPLOYEE"
    };
  }

  const lastIndex = eligibleEmployees.findIndex(
    (employee) => employee.id === lastAssignedEmployeeId
  );

  const nextIndex = lastIndex === -1 ? 0 : (lastIndex + 1) % eligibleEmployees.length;

  const nextEmployee = eligibleEmployees[nextIndex];

  return {
    assignedEmployeeId: nextEmployee.id,
    nextPointerEmployeeId: nextEmployee.id,
    reason: "ROUND_ROBIN"
  };

}
