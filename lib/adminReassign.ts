// Admin bulk Reassign safety (2026-11-13): at most ADMIN_REASSIGN_MAX_PER_CALL leads per click, and a confirm step that
// names the count and the employee. Now that "Select all matching" really selects every matching lead, one click could
// otherwise move thousands. Pure, known-answer tested in scripts/check-admin-select-all.js.
// Server side (2026-11-15): the same limit is enforced by admin_reassign_leads (supabase/sql/2026-11-15_admin_reassign_leads.sql);
// ADMIN_REASSIGN_RPC names it and summarizeAdminReassignResult turns its jsonb answer into toast text.

export const ADMIN_REASSIGN_MAX_PER_CALL = 500;
export const ADMIN_REASSIGN_RPC = "admin_reassign_leads";

export function canBulkReassign(selectedCount: number, max: number = ADMIN_REASSIGN_MAX_PER_CALL): boolean {
  return selectedCount > 0 && selectedCount <= max;
}

export function reassignConfirmTitle(count: number, employeeName: string | null | undefined): string {
  return `Reassign ${count} lead${count === 1 ? "" : "s"} to ${employeeName || "this employee"}?`;
}

export interface AdminReassignSummary {
  reassigned: number;
  failed: string[];
}

export function summarizeAdminReassignResult(data: unknown): AdminReassignSummary {
  const d = (data ?? {}) as { reassigned?: unknown; results?: unknown };
  const results = Array.isArray(d.results) ? (d.results as { lead_id?: string; success?: boolean; error?: string }[]) : [];
  const failed = results
    .filter((r) => !r.success)
    .map((r) => `${String(r.lead_id ?? "").slice(0, 8)} ${String(r.error ?? "failed").replace(/^[a-z_]+: /, "")}`.trim());
  const reassigned = typeof d.reassigned === "number" ? d.reassigned : results.filter((r) => r.success).length;
  return { reassigned, failed };
}
