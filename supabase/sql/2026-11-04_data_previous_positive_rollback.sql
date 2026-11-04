-- Rollback for 2026-11-04_data_previous_positive.sql. The box hides itself when the function is missing.
begin;
drop function if exists public.get_data_previous_positive();
notify pgrst, 'reload schema';
commit;
