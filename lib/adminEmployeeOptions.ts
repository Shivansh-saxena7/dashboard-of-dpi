// Admin employee filter (2026-11-13): active employees first, then employees who have left, so Admin can still find
// (and reassign) the leads a former employee owns. Pure, known-answer tested in scripts/check-admin-employee-options.js.
// Only the Admin Leads page uses it; employee-facing lists and the "Assign to..." picker stay active-only.

export interface AdminEmployeeOption {
  id: string;
  name: string;
  is_active: boolean;
}

export function splitAdminEmployeeOptions<T extends AdminEmployeeOption>(employees: readonly T[]): { active: T[]; inactive: T[] } {
  const byName = (a: T, b: T) => (a.name || "").localeCompare(b.name || "");
  return {
    active: employees.filter((e) => e.is_active).sort(byName),
    inactive: employees.filter((e) => !e.is_active).sort(byName)
  };
}

export function adminEmployeeLabel(employee: AdminEmployeeOption): string {
  return employee.is_active ? employee.name : `${employee.name} (inactive)`;
}
