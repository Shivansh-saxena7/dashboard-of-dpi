-- Rollback of 2026-11-28_admin_card_mode.sql: drops the two columns (the pages then show the old card to everyone).
begin;
alter table public.lead_engine_settings drop column if exists admin_card_pilot_ids, drop column if exists admin_card_mode;
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'lead_engine_settings'
             and column_name in ('admin_card_mode', 'admin_card_pilot_ids')) then
    raise exception 'flag columns still exist';
  end if;
end $$;
commit;
