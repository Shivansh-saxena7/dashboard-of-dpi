-- ROLLBACK for 2026-11-16_admin_edit_leave_end_date.sql: removes the function. Roll the frontend back first (the Edit
-- end date button would show an error). End dates already changed stay; each change is in lead_guard_events
-- (source leave_edit) with its old end date, to put back by hand if needed.
begin;

drop function public.admin_edit_leave_end_date(uuid, date, text);

do $$
begin
  if exists (select 1 from pg_proc where proname = 'admin_edit_leave_end_date' and pronamespace = 'public'::regnamespace) then
    raise exception 'admin_edit_leave_end_date still exists';
  end if;
end $$;

commit;
