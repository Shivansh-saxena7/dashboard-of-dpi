-- 2026-11-27 employee_card_mode: which lead / data card employees see (redesign "Pass" card, 2026-11-26 port). DRAFT,
-- NOT APPLIED. Apply only on the owner's "haan", from an LF copy, after a rolled-back dry run, at least 2 minutes away
-- from a recycle sweep (:00/:15/:30/:45 IST) and the hourly refresh (:37 IST).
-- Rollback: 2026-11-27_employee_card_mode_rollback.sql. Additive: two settings columns, default off (old card for
-- everyone). The app reads lead_engine_settings (select *) with a 2 s timeout; a missing column = old card.
begin;
alter table public.lead_engine_settings
  add column if not exists employee_card_mode text not null default 'off'
    constraint lead_engine_settings_employee_card_mode_check check (employee_card_mode in ('off', 'admin_pilot', 'on')),
  add column if not exists employee_card_pilot_ids uuid[] not null default '{}';
commit;
