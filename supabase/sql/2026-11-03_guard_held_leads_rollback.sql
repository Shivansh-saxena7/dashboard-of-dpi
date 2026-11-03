-- Rollback for 2026-11-03_guard_held_leads.sql. The card hides itself when the function is missing.
begin;
drop function if exists public.get_guard_held_leads();
notify pgrst, 'reload schema';
commit;
