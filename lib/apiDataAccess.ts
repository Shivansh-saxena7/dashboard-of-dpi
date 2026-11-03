// Who may read what from /api/data (2026-11-02). The route used the service_role key with no login
// check, so anyone on the internet could read every employee's name and post links. Pure, no DB access:
// admins see everything (a date is optional); everyone else sees only their own rows for one date.

export interface ApiDataCaller {
  id: string;
  role: string | null;
  is_active: boolean | null;
}

export type ApiDataDecision =
  | { ok: true; employeeId: string | null; date: string | null }
  | { ok: false; status: 400 | 403; error: string };

const ADMIN_ROLES = ["admin", "super_admin"];

export function decideApiDataAccess(
  caller: ApiDataCaller | null,
  requestedEmployeeId: string | null,
  date: string | null
): ApiDataDecision {
  if (!caller || !caller.is_active) {
    return { ok: false, status: 403, error: "Not allowed" };
  }
  const safeDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  if (date && !safeDate) {
    return { ok: false, status: 400, error: "Invalid date" };
  }
  if (ADMIN_ROLES.includes(caller.role ?? "")) {
    return { ok: true, employeeId: requestedEmployeeId || null, date: safeDate };
  }
  if (requestedEmployeeId && requestedEmployeeId !== caller.id) {
    return { ok: false, status: 403, error: "Not allowed" };
  }
  if (!safeDate) {
    return { ok: false, status: 400, error: "A date is required" };
  }
  return { ok: true, employeeId: caller.id, date: safeDate };
}
