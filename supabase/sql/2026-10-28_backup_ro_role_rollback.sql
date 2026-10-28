-- 2026-10-28 — ROLLBACK for 2026-10-28_backup_ro_role.sql. After this the GitHub backup workflow fails
-- (expected) until the role is created again and the secret updated.
begin;
revoke pg_read_all_data from backup_ro;
drop role if exists backup_ro;
commit;
