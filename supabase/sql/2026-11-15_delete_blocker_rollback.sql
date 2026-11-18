-- Rollback for the delete blocker APPLIED 2026-11-15 12:18 IST (live). Not run.
-- ROLLBACK for 2026-11-15_delete_blocker.sql (DRAFT): removes the two triggers and the three functions. Deletes then
-- behave exactly as before (NO ACTION foreign keys refuse, CASCADE ones delete linked rows).
begin;

drop trigger employees_delete_blocker on public.employees;
drop trigger leads_delete_blocker on public.leads;
drop function public.admin_force_delete(text, uuid, text);
drop function public.block_unsafe_delete();
drop function public.delete_blocker_counts(regclass, uuid);

do $$
begin
  if exists (select 1 from pg_trigger where tgname in ('employees_delete_blocker', 'leads_delete_blocker')) then raise exception 'triggers still exist'; end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('admin_force_delete', 'block_unsafe_delete', 'delete_blocker_counts')) then raise exception 'functions still exist'; end if;
end $$;

commit;
