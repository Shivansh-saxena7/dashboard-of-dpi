-- Rollback for 2026-11-20_admin_report_mode.sql (DRAFT, NOT APPLIED): remove the flag; the page hides itself.
begin;
alter table public.lead_engine_settings drop column if exists admin_report_mode;
commit;
