-- ROLLBACK for 2026-11-19_lead_notes_realtime.sql (NOT APPLIED draft). Takes public.lead_notes out of the
-- supabase_realtime publication again; the Home then falls back by itself (channel without the lead_notes binding).
begin;

do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lead_notes') then
    execute 'alter publication supabase_realtime drop table public.lead_notes';
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lead_notes') then
    raise exception 'lead_notes is still in supabase_realtime';
  end if;
end $$;

commit;
