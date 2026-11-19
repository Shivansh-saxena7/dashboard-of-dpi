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
  -- A2 Team today: today's attendance, HR cutoffs, the first start window end, and HR attendance's on-time / late rule
  -- written in SQL for the field employees (active, employee / team leader, no department or Sales, not "testing").
  'attendance_today', (select coalesce(json_agg(json_build_object('employee_id', employee_id, 'shift_start_at', shift_start_at, 'shift_end_at', shift_end_at, 'attendance_type', attendance_type)), '[]')
    from attendance where date = (now() at time zone 'Asia/Kolkata')::date),
  'hrms', (select json_build_object('first_half_ontime_cutoff', first_half_ontime_cutoff, 'second_half_ontime_cutoff', second_half_ontime_cutoff) from hrms_settings where id = 1),
  'window_end', (select first_half_start_window_end from lead_engine_settings where id = 1),
  'sql_hr', (select json_build_object(
      'started', count(*) filter (where a.shift_start_at is not null and a.shift_end_at is null),
      'late', count(*) filter (where a.shift_start_at is not null and a.shift_end_at is null and a.attendance_type not in ('LEAVE', 'HALF_DAY_MANUAL')
        and (a.shift_start_at at time zone 'Asia/Kolkata')::time > (case when a.attendance_type = 'HALF_DAY_SECOND' then h.second_half_ontime_cutoff else h.first_half_ontime_cutoff end)))
    from employees e
    join attendance a on a.employee_id = e.id and a.date = (now() at time zone 'Asia/Kolkata')::date
    cross join hrms_settings h
    where h.id = 1 and e.is_active and e.role in ('employee', 'team_leader') and (e.department is null or e.department = 'sales')
      and lower(trim(e.name)) <> 'testing' and e.id <> 'd970af89-063d-48b4-98aa-b89260fb3d87'),
  -- A3 Lead engine: the rows the Home reads for both windows, and the same numbers counted in SQL.
  'engine_guard_today', (select coalesce(json_agg(json_build_object('source', source, 'action', action)), '[]') from lead_guard_events, t0 where created_at >= t0.day_start and created_at < now()),
  'engine_guard_yesterday', (select coalesce(json_agg(json_build_object('source', source, 'action', action)), '[]') from lead_guard_events, t0 where created_at >= t0.day_start - interval '1 day' and created_at < now() - interval '1 day'),
  'engine_restore', (select coalesce(json_agg(json_build_object('protected_until', protected_until, 'restored_at', restored_at, 'undone_at', undone_at)), '[]') from lead_restore_log where protected_until > now() - interval '1 day'),
  'sql_engine', (select json_build_object(
      'recycled_today', (select count(*) from lead_history, t0 where assigned_by_type = 'SYSTEM' and recycle_reason is not null and assigned_at >= t0.day_start and assigned_at < now()),
      'recycled_yesterday', (select count(*) from lead_history, t0 where assigned_by_type = 'SYSTEM' and recycle_reason is not null and assigned_at >= t0.day_start - interval '1 day' and assigned_at < now() - interval '1 day'),
      'refused_today', (select count(*) from lead_guard_events, t0 where source = 'db_positive_junk_guard' and action = 'JUNK_REFUSED' and created_at >= t0.day_start and created_at < now()),
      'guard_groups_today', (select count(distinct source || '/' || action) from lead_guard_events, t0 where created_at >= t0.day_start and created_at < now()),
      'protections_open', (select count(*) from lead_restore_log where undone_at is null and protected_until > now()))),
  -- The daily job's own answer today (System Health warning no_shift_alert), if it ran.
  'job_no_shift', (select json_build_object('ran', count(*) > 0, 'flagged', max(jsonb_array_length(coalesce(context->'employees', '[]'::jsonb))))
    from system_anomaly_log, t0 where source = 'no_shift_alert' and last_seen_at >= t0.day_start)
) j;
