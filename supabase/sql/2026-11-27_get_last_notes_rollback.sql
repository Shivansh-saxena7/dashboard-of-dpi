-- Rollback of 2026-11-27_get_last_notes.sql: drops the function (the cards then hide the last-note panel).
begin;
drop function if exists public.get_last_notes(uuid[]);
commit;
