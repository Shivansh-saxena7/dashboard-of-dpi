-- READ-ONLY export for the Admin Home live parity check (node scripts/parity-admin-home.js --live <file>). Writes
-- nothing. Run: npx supabase db query --remote --read-only -f scripts/admin-home-live.sql > <scratch>/admin_live.txt
-- The output holds employee ids (to count) but no names; keep it in a scratch folder and delete it after the check.
with t0 as (select ((now() at time zone 'Asia/Kolkata')::date)::timestamp at time zone 'Asia/Kolkata' as day_start)
select json_build_object(
  'now', now(),
  'calendar', jsonb_build_object(
    'timezone', 'Asia/Kolkata',
    'weekly_off_day', (select sla_weekly_off_day from lead_engine_settings where id = 1),
    'timers_enabled', coalesce((select working_days_timers_enabled from lead_engine_settings where id = 1), false),
    'ranges', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'starts_at', p.starts_at, 'ends_at', p.ends_at, 'reason', p.reason, 'kind', p.kind))
      from non_working_periods p where p.cancelled_at is null and p.starts_at < now() + interval '60 days' and p.ends_at > now() - interval '90 days'), '[]'::jsonb)),
  'heartbeats', (select coalesce(json_agg(json_build_object('function_name', function_name, 'max_silence_minutes', max_silence_minutes, 'last_succeeded_at', last_succeeded_at)), '[]') from cron_heartbeats),
  'backup', (select row_to_json(b) from (select run_at, status from backup_run_log order by run_at desc limit 1) b),
  -- The Home's read: today's not-reviewed rows (source + severity only).
  'anomalies', (select coalesce(json_agg(json_build_object('source', source, 'severity', severity)), '[]') from system_anomaly_log, t0 where reviewed = false and last_seen_at >= t0.day_start),
  -- System Health's own "problem" rule, written in SQL: not info, not a guard-activity source, not call_return:/network:.
  'sh_problems', (select json_build_object(
      'errors', count(*) filter (where severity = 'error'),
      'warnings', count(*) filter (where severity = 'warning'))
    from system_anomaly_log, t0
    where reviewed = false and last_seen_at >= t0.day_start and severity <> 'info'
      and source not in ('db_sibling_guard','recycle_sibling_guard_shadow','distribution_guard_shadow','recycle_prev_owner_fallback','personal_lead_block','recycle_auto_junk_breaker','session_expired')
      and source not like 'call_return:%' and source not like 'network:%'),
  'transfers', (select count(*) from lead_transfer_requests where status = 'PENDING'),
  'employee_requests', (select count(*) from employee_creation_requests where status = 'PENDING'),
  'employees', (select coalesce(json_agg(json_build_object('id', id, 'name', case when lower(trim(name)) = 'testing' then 'testing' else 'x' end, 'is_active', is_active, 'role', role, 'department', department, 'created_at', created_at)), '[]') from employees where is_active),
  'leave', (select coalesce(json_agg(json_build_object('employee_id', employee_id, 'start_date', start_date, 'end_date', end_date)), '[]') from employee_leave_periods),
  'attendance', (select coalesce(json_agg(json_build_object('employee_id', employee_id, 'date', date)), '[]') from attendance where date >= ((now() at time zone 'Asia/Kolkata')::date - 45) and shift_start_at is not null),
  'joins', (select coalesce(json_agg(json_build_object('employee_id', employee_id, 'date_of_joining', date_of_joining)), '[]') from employee_payroll_details),
  -- The daily job's own answer today (System Health warning no_shift_alert), if it ran.
  'job_no_shift', (select json_build_object('ran', count(*) > 0, 'flagged', max(jsonb_array_length(coalesce(context->'employees', '[]'::jsonb))))
    from system_anomaly_log, t0 where source = 'no_shift_alert' and last_seen_at >= t0.day_start)
) j;
