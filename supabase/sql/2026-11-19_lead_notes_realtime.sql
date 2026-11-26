-- NOT APPLIED. DRAFT 2026-11-19 (feature/home-e7-live). Apply only on the owner's "haan", from an LF copy
-- (git cat-file -p), CR count 0, rolled-back dry run first, at least 2 minutes away from a sweep (:00/:15/:30/:45).
-- Employee Home E7: reminders refresh at once. Adds public.lead_notes to the supabase_realtime publication, so the Home's
-- existing channel (lib/useEmployeeHome.ts) can carry the employee's own lead_notes changes. Additive only: no table,
-- column, policy, grant or data change. Realtime still applies lead_notes RLS, so an employee only receives their own
-- rows (policy: employee_id = current_employee_id()). Until this is applied the Home falls back by itself (the channel
-- joins without the lead_notes binding) and reminders refresh after a save or when the app comes back.
-- Load: one realtime message per lead_notes insert/update (about one per saved result with a note).
-- Rollback: 2026-11-19_lead_notes_realtime_rollback.sql.
begin;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lead_notes') then
    execute 'alter publication supabase_realtime add table public.lead_notes';
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lead_notes') then
    raise exception 'lead_notes is not in supabase_realtime after apply';
  end if;
end $$;

commit;
