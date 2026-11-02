// Which admin may do what to which account (2026-11-02). Pure, no DB access.

// Changing a login (email / password): a super_admin may change anyone's. An admin may change their
// own and those of non-admin users, never another admin's or a super_admin's. An account with no
// employee row has an unknown role, so only a super_admin may touch it.
export function canEditLogin(
  callerRole: string,
  callerAuthUserId: string,
  targetAuthUserId: string,
  targetRole: string | null | undefined
): boolean {
  if (callerRole === "super_admin") return true;
  if (callerRole !== "admin") return false;
  if (callerAuthUserId === targetAuthUserId) return true;
  return Boolean(targetRole) && targetRole !== "admin" && targetRole !== "super_admin";
}

// Creating an account: only a super_admin may create another super_admin.
export function canCreateRole(callerRole: string, newRole: unknown): boolean {
  if (callerRole === "super_admin") return true;
  if (callerRole !== "admin") return false;
  return typeof newRole === "string" && newRole.trim().toLowerCase() !== "super_admin";
}

// Deleting an employee is permanent, so it is for a super_admin only.
export function canDeleteEmployee(callerRole: string): boolean {
  return callerRole === "super_admin";
}
