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

// Stage mode (2026-11-15): the 4-parameter admin_reassign_leads (supabase/sql/2026-11-15_admin_reassign_stage_mode.sql).
// "auto" keeps the stage of positive leads (reassign_keep_state_atomic, 14-day protection) and resets the rest;
// "reset" resets every lead to New. The same positive rule as the SQL, so the confirm dialog's counts match.
export type AdminReassignStageMode = "auto" | "reset";
export const ADMIN_REASSIGN_DEFAULT_STAGE_MODE: AdminReassignStageMode = "auto";
export const KEEP_STAGE_PROTECTION_DAYS = 14;

export function isPositiveForReassign(status: string | null | undefined, boardStage: string | null | undefined): boolean {
  return ["FOLLOW_UP", "VISIT", "BOOKING"].includes(boardStage || "LEADS") || ["CONNECTED", "CONVERTED"].includes(status || "");
}

export function reassignStageSplit(
  leads: readonly { status?: string | null; board_stage?: string | null }[],
  mode: AdminReassignStageMode
): { kept: number; reset: number } {
  const kept = mode === "auto" ? leads.filter((l) => isPositiveForReassign(l.status, l.board_stage)).length : 0;
  return { kept, reset: leads.length - kept };
}

export function reassignStageSummary(split: { kept: number; reset: number }): string {
  const lead = (n: number) => `${n} lead${n === 1 ? "" : "s"}`;
  if (split.kept === 0) return `${lead(split.reset)} will be reset to New.`;
  if (split.reset === 0) return `${lead(split.kept)} will keep ${split.kept === 1 ? "its" : "their"} stage.`;
  return `${lead(split.kept)} will keep ${split.kept === 1 ? "its" : "their"} stage, ${lead(split.reset)} will be reset to New.`;
}

export function reassignKeptCount(data: unknown): number {
  const kept = (data ?? {}) as { kept?: unknown };
  return typeof kept.kept === "number" ? kept.kept : 0;
}
