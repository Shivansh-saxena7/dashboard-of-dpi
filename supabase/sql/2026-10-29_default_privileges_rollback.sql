-- Rollback for 2026-10-29_default_privileges.sql: new functions get EXECUTE for PUBLIC and anon again (as before).
begin;
alter default privileges for role postgres in schema public grant execute on functions to anon;
alter default privileges for role postgres grant execute on functions to public;
commit;
