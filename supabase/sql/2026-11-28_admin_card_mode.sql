-- 2026-11-28 admin_card_mode: which lead card Admin / Super Admin / Sales Coordinator see on /admin/leads and
-- /coordinator (redesign "Pass" card, 2026-11-27 admin card port). DRAFT, NOT APPLIED. Apply only on the owner's
-- "haan", from an LF copy, after a rolled-back dry run, at least 2 minutes away from a recycle sweep
-- (:00/:15/:30/:45 IST) and the hourly refresh (:37 IST).
-- Rollback: 2026-11-28_admin_card_mode_rollback.sql. Additive: two settings columns, default off (old card for
-- everyone). The pages read lead_engine_settings (select *) with a 2 s timeout; a missing column = old card.
begin;
alter table public.lead_engine_settings
  add column if not exists admin_card_mode text not null default 'off'
    constraint lead_engine_settings_admin_card_mode_check check (admin_card_mode in ('off', 'admin_pilot', 'on')),
  add column if not exists admin_card_pilot_ids uuid[] not null default '{}';
do $$
begin
  if (select admin_card_mode from public.lead_engine_settings where id = 1) is distinct from 'off' then
    raise exception 'admin_card_mode is not off after apply';
  end if;
end $$;
commit;
