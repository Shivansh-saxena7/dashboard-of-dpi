-- 2026-10-28 — ROLLBACK for 2026-10-28_backup_heartbeat.sql
begin;
drop function if exists public.record_backup_heartbeat();
delete from cron_heartbeats where function_name = 'db-backup';
commit;
