-- READ-ONLY export for the Employee Home live parity check (scripts/parity-employee-home.js --live). Writes nothing.
-- Run with: npx supabase db query --remote --read-only -f scripts/home-parity-live.sql > <scratch>/home_live.txt
-- Edit the employee id prefixes (8 characters each) in the array below. The output holds lead ids (needed to count) but
-- no names or numbers; keep it in a scratch folder and delete it after the check (see scripts/home-parity-live.md).
with pick as (
  select e.id, left(e.id::text, 8) as id8
  from employees e
  where left(e.id::text, 8) = any (array['xxxxxxxx'])
),
bounds as (
  select ((now() at time zone 'Asia/Kolkata')::date - 1)::timestamp at time zone 'Asia/Kolkata' as y_start,
         ((now() at time zone 'Asia/Kolkata')::date + 1)::timestamp at time zone 'Asia/Kolkata' as t_end
)
select json_build_object(
  'now', now(),
  -- Same shape as get_working_calendar (which the read-only role may not call), built from the same tables.
  'calendar', jsonb_build_object(
    'timezone', 'Asia/Kolkata',
    'weekly_off_day', (select sla_weekly_off_day from lead_engine_settings where id = 1),
    'timers_enabled', coalesce((select working_days_timers_enabled from lead_engine_settings where id = 1), false),
    'ranges', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'starts_at', p.starts_at, 'ends_at', p.ends_at, 'reason', p.reason, 'kind', p.kind) order by p.starts_at)
      from non_working_periods p
      where p.cancelled_at is null and p.starts_at < now() + interval '400 days' and p.ends_at > now() - interval '60 days'
    ), '[]'::jsonb)
  ),
  'employees', (select coalesce(json_agg(json_build_object(
    'id8', p.id8,
    -- The Home's / LeadList's rows: current owner, LEAD, the employee's active assignment.
    'leads', (select coalesce(json_agg(json_build_object(
        'id', l.id, 'status', l.status, 'board_stage', l.board_stage, 'sla_deadline', l.sla_deadline,
        'recycle_count', l.recycle_count, 'is_personal_lead', l.is_personal_lead,
        'lead_history', json_build_array(json_build_object(
          'call_count', h.call_count, 'outcome_at', h.outcome_at, 'assigned_at', h.assigned_at, 'first_call_at', h.first_call_at,
          'first_whatsapp_at', h.first_whatsapp_at, 'last_activity_at', h.last_activity_at, 'paused_until', h.paused_until,
          'pause_reason', h.pause_reason, 'last_call_click_at', h.last_call_click_at)))), '[]'::json)
      from leads l join lead_history h on h.lead_id = l.id and h.employee_id = p.id and h.is_active
      where l.current_owner_id = p.id and l.lead_type = 'LEAD'),
    -- Home "N Data": one count with /data's filters (one per lead).
    'data_count', (select count(*) from leads l where l.current_owner_id = p.id and l.lead_type = 'DATA'
                     and exists (select 1 from lead_history h where h.lead_id = l.id and h.employee_id = p.id and h.is_active)),
    -- /data's list: one card per (lead, active assignment) row; differs from data_count only if a lead had two active rows.
    'data_list', (select count(*) from leads l join lead_history h on h.lead_id = l.id and h.employee_id = p.id and h.is_active
                  where l.current_owner_id = p.id and l.lead_type = 'DATA'),
    -- The Home's reminders read: own lead_notes, yesterday + today (IST).
    'reminders', (select coalesce(json_agg(json_build_object('lead_id', n.lead_id, 'reminder_at', n.reminder_at)), '[]'::json)
      from lead_notes n, bounds b where n.employee_id = p.id and n.reminder_at >= b.y_start and n.reminder_at < b.t_end),
    'leave', (select coalesce(json_agg(json_build_object('employee_id', v.employee_id, 'start_date', v.start_date, 'end_date', v.end_date)), '[]'::json)
      from employee_leave_periods v where v.employee_id = p.id)
  )), '[]'::json) from pick p)
) j;
