-- 2026-10-16 — ROLLBACK for 2026-10-16_p4_safety_layers.sql
begin;
select cron.unschedule('lead-integrity-nightly');
drop function if exists public.run_lead_integrity_checks();
drop trigger if exists leads_distribution_guard_shadow on leads;
drop function if exists public.distribution_guard_shadow_log();
drop function if exists public.distribution_guard_holder(uuid, text);
-- Settings columns: safe to keep (recycle-stale-leads treats them as optional).
-- Drop only if the edge function no longer reads them:
-- alter table lead_engine_settings drop column if exists auto_junk_enabled, drop column if exists auto_recycle_enabled,
--   drop column if exists max_auto_junk_per_sweep, drop column if exists distribution_guard_mode;
commit;
