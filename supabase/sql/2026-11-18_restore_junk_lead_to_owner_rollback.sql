-- Rollback for restore_junk_lead_to_owner APPLIED 2026-11-18 13:32 IST (live). Not run.
-- ROLLBACK for 2026-11-18_restore_junk_lead_to_owner.sql: removes the function and its two helpers. Leads already given
-- back stay with their new owner; each one has a lead_restore_log row (prev_state) and an ADMIN_RESTORE_ONE event.
begin;

drop function public.restore_junk_lead_to_owner(uuid, uuid, text);
drop function public.employee_in_return_grace(uuid, date);
drop function public.company_working_day(date);

do $$
begin
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
             and proname in ('restore_junk_lead_to_owner', 'employee_in_return_grace', 'company_working_day')) then
    raise exception 'functions still exist';
  end if;
end $$;

commit;
