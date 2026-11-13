// Admin bulk "Mark as junk" (2026-11-13). The limit matches admin_mark_leads_junk (supabase/sql/2026-11-13_admin_mark_leads_junk.sql);
// the summary turns its jsonb answer into toast text. Pure, known-answer tested in scripts/check-admin-employee-options.js.

export const ADMIN_JUNK_MAX_PER_CALL = 50;

export interface AdminJunkSummary {
  junked: number;
  failed: string[];
}

export function summarizeAdminJunkResult(data: unknown): AdminJunkSummary {
  const d = (data ?? {}) as { junked?: unknown; results?: unknown };
  const results = Array.isArray(d.results) ? (d.results as { lead_id?: string; success?: boolean; error?: string }[]) : [];
  const failed = results
    .filter((r) => !r.success)
    .map((r) => `${String(r.lead_id ?? "").slice(0, 8)} ${r.error ?? "failed"}`.trim());
  const junked = typeof d.junked === "number" ? d.junked : results.filter((r) => r.success).length;
  return { junked, failed };
}
