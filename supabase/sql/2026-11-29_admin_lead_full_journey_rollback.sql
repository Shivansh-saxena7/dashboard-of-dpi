-- ROLLBACK for 2026-11-29_admin_lead_full_journey.sql (DRAFT, NOT APPLIED). Drops the read-only journey function; the
-- History modal then falls back to the old timeline (as before). Nothing else changes. LF copy, dry run first.
begin;

drop function if exists public.get_admin_lead_full_journey(uuid);

do $$
begin
  if exists (select 1 from pg_proc where proname = 'get_admin_lead_full_journey' and pronamespace = 'public'::regnamespace) then
    raise exception 'function still exists';
  end if;
end $$;

commit;
