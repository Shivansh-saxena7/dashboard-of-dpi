-- 2026-10-28 — heartbeat for the nightly DB dump. APPLIED 2026-10-28 13:31 IST after the first PASS run.
-- Rollback: 2026-10-28_backup_heartbeat_rollback.sql
--
-- The workflow calls record_backup_heartbeat() after a successful encrypted upload. The existing hourly
-- watchdog (check_cron_heartbeats) logs an error to system_anomaly_log ("cron-watchdog:db-backup") when
-- the row is older than 26 h, so both "workflow failed" and "workflow never ran" show on /admin/system-health.
-- backup_ro gets EXECUTE on this one function only; the function touches only its own heartbeat row.
begin;
insert into cron_heartbeats (function_name, max_silence_minutes, last_succeeded_at)
values ('db-backup', 1560, now())
on conflict (function_name) do nothing;

create or replace function public.record_backup_heartbeat()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update cron_heartbeats set last_succeeded_at = now() where function_name = 'db-backup';
$function$;
revoke all on function public.record_backup_heartbeat() from public, anon, authenticated;
grant execute on function public.record_backup_heartbeat() to backup_ro;
commit;
