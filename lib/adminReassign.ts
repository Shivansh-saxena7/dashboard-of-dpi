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

// Chunked bulk Reassign (2026-11-15): 500 leads in one call took 8.3 s in a live dry run, over the 8 s API statement
// limit, so the page sends ADMIN_REASSIGN_CHUNK leads per call, one call after the other. A call that fails as a whole
// (network, timeout, server refusal) stops the rest: those leads were not processed and stay selected for a retry.
export const ADMIN_REASSIGN_CHUNK = 100;

export function chunkLeadIds(ids: readonly string[], size: number = ADMIN_REASSIGN_CHUNK): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

export interface ChunkedReassignResult {
  reassigned: number;
  kept: number;
  failed: string[];
  notProcessed: string[];
  stoppedError: string | null;
  calls: number;
}

export async function runChunkedReassign(
  ids: readonly string[],
  callChunk: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message?: string } | null }>,
  onProgress?: (sent: number, total: number) => void,
  size: number = ADMIN_REASSIGN_CHUNK
): Promise<ChunkedReassignResult> {
  const chunks = chunkLeadIds(ids, size);
  const result: ChunkedReassignResult = { reassigned: 0, kept: 0, failed: [], notProcessed: [], stoppedError: null, calls: 0 };
  let sent = 0;
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(sent + chunks[i].length, ids.length);
    let answer: { data: unknown; error: { message?: string } | null };
    try {
      answer = await callChunk(chunks[i]);
    } catch (err) {
      answer = { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
    }
    result.calls += 1;
    if (answer.error) {
      result.stoppedError = answer.error.message || "the server did not answer";
      result.notProcessed = chunks.slice(i).flat();
      return result;
    }
    const summary = summarizeAdminReassignResult(answer.data);
    result.reassigned += summary.reassigned;
    result.kept += reassignKeptCount(answer.data);
    result.failed.push(...summary.failed);
    sent += chunks[i].length;
  }
  return result;
}
