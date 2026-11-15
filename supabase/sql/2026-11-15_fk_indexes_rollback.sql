-- ROLLBACK for 2026-11-15_fk_indexes.sql: drops the three indexes (deletes become slow again, nothing else changes).
begin;

drop index if exists public.notification_related_lead_id_idx;
drop index if exists public.lead_notes_lead_id_idx;
drop index if exists public.leads_merged_into_lead_id_idx;

commit;
