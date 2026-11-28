-- ROLLBACK for 2026-11-29_admin_lead_contacts.sql (DRAFT, NOT APPLIED). Drops the lookup; the two admin tabs then show
-- the lead id only again (as before), nothing else changes. LF copy, dry run first.
begin;

drop function if exists public.get_admin_lead_contacts(uuid[]);

do $$
begin
  if exists (select 1 from pg_proc where proname = 'get_admin_lead_contacts' and pronamespace = 'public'::regnamespace) then
    raise exception 'function still exists';
  end if;
end $$;

commit;
