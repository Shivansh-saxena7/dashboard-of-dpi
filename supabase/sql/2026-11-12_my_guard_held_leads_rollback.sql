-- Rollback for 2026-11-12_my_guard_held_leads.sql. The "Needs your call" option hides itself when the function is missing.
begin;
drop function if exists public.get_my_guard_held_leads();
notify pgrst, 'reload schema';
commit;
