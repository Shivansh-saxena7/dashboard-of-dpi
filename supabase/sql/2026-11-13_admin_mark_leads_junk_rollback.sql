-- ROLLBACK for 2026-11-13_admin_mark_leads_junk.sql: removes the function (the frontend button then shows an error toast).
-- Leads already junked through it stay JUNK; undo those one by one with the existing JUNK-recovery Reassign.
begin;

drop function public.admin_mark_leads_junk(uuid[], text);

do $$
begin
  if exists (select 1 from pg_proc where proname = 'admin_mark_leads_junk' and pronamespace = 'public'::regnamespace) then
    raise exception 'admin_mark_leads_junk still exists';
  end if;
end $$;

commit;
