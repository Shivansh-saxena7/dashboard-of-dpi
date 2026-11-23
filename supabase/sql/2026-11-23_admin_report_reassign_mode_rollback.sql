-- Rollback for 2026-11-23_admin_report_reassign_mode.sql (DRAFT, NOT APPLIED): remove the flag; the page hides the
-- give / give back controls.
begin;
alter table public.lead_engine_settings drop column if exists admin_report_reassign_mode;
commit;
