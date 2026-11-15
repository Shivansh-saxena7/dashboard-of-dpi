-- ROLLBACK for 2026-11-15_admin_reassign_leads.sql: removes the function. Roll the frontend back first (to the commit
-- before fix/bulk-reassign-server-limit), so the Reassign button calls bulk_reassign_leads_atomic again; with only this
-- rollback, the new button shows an error toast and nothing moves. Leads already reassigned through it stay with the
-- new employee (their lead_history / lead_forced_removals rows show it); move any back one by one with Reassign.
begin;

drop function public.admin_reassign_leads(uuid[], uuid, text);

do $$
begin
  if exists (select 1 from pg_proc where proname = 'admin_reassign_leads' and pronamespace = 'public'::regnamespace) then
    raise exception 'admin_reassign_leads still exists';
  end if;
end $$;

commit;
