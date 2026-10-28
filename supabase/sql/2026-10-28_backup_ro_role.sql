-- 2026-10-28 — read-only role for the nightly DB dump (private repo dpi-db-backup, GitHub Actions).
-- Rollback: 2026-10-28_backup_ro_role_rollback.sql
--
-- backup_ro can read every table (pg_read_all_data) and must bypass RLS, because pg_dump runs with
-- row_security = off and would otherwise refuse the 107 RLS tables. It cannot write: no table, schema
-- or function grants beyond pg_read_all_data, and its sessions default to read-only transactions.
-- The password is NOT in this file: it is generated at apply time, set with ALTER ROLE from a
-- throw-away file, and stored only in the GitHub secret SUPABASE_DB_URL.
begin;
create role backup_ro with login bypassrls connection limit 3;
grant pg_read_all_data to backup_ro;
alter role backup_ro set default_transaction_read_only = on;
alter role backup_ro set statement_timeout = '30min';
alter role backup_ro set idle_in_transaction_session_timeout = '5min';
commit;
-- then, at apply time only (not stored): alter role backup_ro with password '<generated>';
