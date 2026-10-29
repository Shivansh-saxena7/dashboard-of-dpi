-- 2026-10-29 — Default privileges for new functions. APPLIED 2026-10-29 16:3x IST (owner's "haan", LF copy of 8d769f7); verified on a rolled-back test function, existing ACLs unchanged (md5 6fe0bd67…).
-- Rollback: 2026-10-29_default_privileges_rollback.sql
--
-- Today every function postgres creates in public gets EXECUTE for PUBLIC (built-in) and anon (Supabase default), so each
-- new SECURITY DEFINER RPC is callable without login unless its file revokes it. After this, new functions start with
-- EXECUTE for postgres, authenticated and service_role only; a function meant for anon must be granted explicitly.
-- Existing functions are not touched. All 119 public functions are owned by postgres; supabase_admin's own default (also
-- granting anon) cannot be changed by postgres and only matters for objects supabase_admin creates.
-- Dry-run 2026-10-29: a function created after this has acl {postgres, authenticated, service_role}.
begin;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres revoke execute on functions from public;
commit;
