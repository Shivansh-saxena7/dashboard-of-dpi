// Admin Leads "Select all matching" (2026-11-13). The page's filters (applyLeadFilters) run on lead_history.is_active,
// lead_history.recycle_reason and lead_history.assigned_at, so every query they are applied to must embed lead_history
// with !inner, exactly like the main list (LEADS_SELECT); without the embed PostgREST answers 400 (PGRST108) and the
// Select-all silently selected nothing. Only the columns the filters need are fetched. Guarded by
// scripts/check-admin-select-all.js.
export const ADMIN_SELECT_ALL_SELECT = "id, status, board_stage, lead_history!inner ( is_active, recycle_reason, assigned_at )";
