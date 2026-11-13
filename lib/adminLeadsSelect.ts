// Admin Leads "Select all matching" (2026-11-13). The page's filters (applyLeadFilters) run on lead_history.is_active,
// lead_history.recycle_reason and lead_history.assigned_at, so every query they are applied to must embed lead_history
// with !inner, exactly like the main list (LEADS_SELECT); without the embed PostgREST answers 400 (PGRST108) and the
// Select-all silently selected nothing. Only the columns the filters need are fetched. Guarded by
// scripts/check-admin-select-all.js.
export const ADMIN_SELECT_ALL_SELECT = "id, status, board_stage, lead_history!inner ( is_active, recycle_reason, assigned_at )";

// Admin Leads search (2026-11-13): PostgREST's or() treats , ( ) as list / group syntax, so a name like "Sharma, R"
// broke the whole query ("failed to parse logic tree"). They become spaces; * and % are wildcards in ilike, also out.
export function adminSearchTerm(raw: string): string {
  return (raw || "").replace(/[,()*%\\]/g, " ").replace(/\s+/g, " ").trim();
}
