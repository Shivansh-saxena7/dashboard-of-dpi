-- 2026-11-23 Performance Report "give leads from the report" flag. DRAFT, NOT APPLIED. Apply after
-- 2026-11-23_perf_report_reassign.sql, on the owner's "haan", from an LF copy, away from a sweep and the :37 refresh.
-- Rollback: 2026-11-23_admin_report_reassign_mode_rollback.sql. Additive: one column, default 'off' (no select boxes,
-- no Give buttons, no journey tags on the page). Missing column = off. Turn on with:
--   update public.lead_engine_settings set admin_report_reassign_mode = 'on' where id = 1;
begin;
alter table public.lead_engine_settings
  add column if not exists admin_report_reassign_mode text not null default 'off'
    constraint lead_engine_settings_admin_report_reassign_mode_check check (admin_report_reassign_mode in ('off', 'on'));
commit;
