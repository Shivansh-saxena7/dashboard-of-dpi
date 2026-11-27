-- ROLLBACK for 2026-11-28_admin_guard_event_counts.sql (DRAFT, NOT APPLIED). Drops the read-only function; the Admin Home
-- Lead engine tile then shows "Couldn't load..." again (as before), the rest of the page is unaffected. LF copy, dry run first.
begin;

drop function if exists public.get_admin_guard_event_counts(timestamptz, timestamptz);

do $$
begin
  if exists (select 1 from pg_proc where proname = 'get_admin_guard_event_counts' and pronamespace = 'public'::regnamespace) then
    raise exception 'function still exists';
  end if;
end $$;

commit;
