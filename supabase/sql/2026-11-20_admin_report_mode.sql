-- APPLIED 2026-11-20 17:48 IST (live), and set to on at 17:48:50 IST. The DRAFT wording below is from before the apply.
-- 2026-11-20 Admin Performance Report page flag. DRAFT, NOT APPLIED. Apply last (after the report SQL, its first
-- build and the hourly job), on the owner's "haan", from an LF copy, away from a sweep. Rollback:
-- 2026-11-20_admin_report_mode_rollback.sql. Additive: one column, default 'off' (the page stays hidden). While the
-- column does not exist the page also stays hidden. Turn on with:
--   update public.lead_engine_settings set admin_report_mode = 'on' where id = 1;
begin;
alter table public.lead_engine_settings
  add column if not exists admin_report_mode text not null default 'off'
    constraint lead_engine_settings_admin_report_mode_check check (admin_report_mode in ('off', 'on'));
commit;
