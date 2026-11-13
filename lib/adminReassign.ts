// Admin bulk Reassign safety (2026-11-13): at most ADMIN_REASSIGN_MAX_PER_CALL leads per click, and a confirm step that
// names the count and the employee. Now that "Select all matching" really selects every matching lead, one click could
// otherwise move thousands. Pure, known-answer tested in scripts/check-admin-select-all.js.

export const ADMIN_REASSIGN_MAX_PER_CALL = 500;

export function canBulkReassign(selectedCount: number, max: number = ADMIN_REASSIGN_MAX_PER_CALL): boolean {
  return selectedCount > 0 && selectedCount <= max;
}

export function reassignConfirmTitle(count: number, employeeName: string | null | undefined): string {
  return `Reassign ${count} lead${count === 1 ? "" : "s"} to ${employeeName || "this employee"}?`;
}
