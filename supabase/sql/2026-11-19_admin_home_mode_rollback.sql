-- ROLLBACK for 2026-11-19_admin_home_mode.sql (NOT APPLIED draft). Removes the two flag columns; the app then reads them
-- as missing and shows the old Admin dashboard. Run from an LF copy, rolled-back dry run first.
begin;

alter table public.lead_engine_settings
  drop column if exists admin_home_pilot_ids,
  drop column if exists admin_home_mode;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'lead_engine_settings'
             and column_name in ('admin_home_mode', 'admin_home_pilot_ids')) then
    raise exception 'flag columns still exist';
  end if;
end $$;

commit;
