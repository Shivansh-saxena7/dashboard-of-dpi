-- Rollback for 2026-10-28_call_quality.sql: puts every object back exactly as it was before
-- (function bodies below are the live definitions saved on 2026-10-28 before the change).
-- Loses only what Call Quality itself recorded: the click->outcome links and nudge timestamps.
begin;
select cron.unschedule(jobid) from cron.job where jobname in ('call-outcome-nudges', 'call-quality-daily-summary');

drop function if exists public.send_call_outcome_nudges();
drop function if exists public.send_call_quality_daily_summary();
drop function if exists public.update_call_quality_settings(jsonb);
drop function if exists public.get_call_quality_summary(uuid, date, date);
drop function if exists public.get_call_quality_details(uuid, date, date);
drop function if exists public.call_quality_assert_access(uuid);
drop function if exists public.call_quality_totals_json(jsonb, integer);
drop function if exists public.call_quality_daily(uuid, date, date);
drop function if exists public.call_quality_score(bigint, bigint, bigint, integer);
drop view if exists public.call_quality_flags;
drop view if exists public.call_quality_clicks;

-- work report and status update: previous bodies (they reference nothing created above once restored)
CREATE OR REPLACE FUNCTION public.get_employee_work_report(p_employee_id uuid, p_date date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_id uuid;
  v_caller_role text;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_calls int;
  v_call_details json;
  v_connected int;
  v_connected_details json;
  v_not_connected int;
  v_not_connected_details json;
  v_switched_off int;
  v_switched_off_details json;
  v_not_interested int;
  v_not_interested_details json;
  v_converted int;
  v_converted_details json;
  v_followups int;
  v_followup_details json;
  v_visits int;
  v_visit_details json;
  v_bookings int;
  v_booking_details json;
  v_stuck_leads int;
  v_stuck_leads_details json;
  v_personal_leads int;
  v_personal_lead_details json;
begin
  v_caller_id := current_employee_id();
  if v_caller_id is null then
    raise exception 'get_employee_work_report: caller is not a recognized employee';
  end if;

  v_caller_role := current_employee_role();

  if p_employee_id <> v_caller_id and v_caller_role not in ('admin', 'super_admin', 'sales_coordinator') then
    raise exception 'get_employee_work_report: not authorized to view another employee''s report';
  end if;

  v_day_start := (p_date::text || ' 00:00:00+05:30')::timestamptz;
  v_day_end := v_day_start + interval '1 day';

  select count(*), coalesce(json_agg(json_build_object('leadName', l.name, 'time', ccl.clicked_at) order by ccl.clicked_at desc), '[]'::json)
  into v_calls, v_call_details
  from contact_click_log ccl
  join leads l on l.id = ccl.lead_id
  where ccl.employee_id = p_employee_id
    and ccl.click_type = 'CALL'
    and ccl.clicked_at >= v_day_start and ccl.clicked_at < v_day_end;

  select count(*), coalesce(json_agg(json_build_object('leadName', l.name, 'time', lal.created_at) order by lal.created_at desc), '[]'::json)
  into v_connected, v_connected_details
  from lead_activity_log lal
  join leads l on l.id = lal.lead_id
  where lal.employee_id = p_employee_id
    and lal.activity_type = 'STATUS_UPDATE'
    and lal.detail = 'CONNECTED'
    and lal.created_at >= v_day_start and lal.created_at < v_day_end;

  select count(*), coalesce(json_agg(json_build_object('leadName', l.name, 'time', lal.created_at) order by lal.created_at desc), '[]'::json)
  into v_not_connected, v_not_connected_details
  from lead_activity_log lal
  join leads l on l.id = lal.lead_id
  where lal.employee_id = p_employee_id
    and lal.activity_type = 'STATUS_UPDATE'
    and lal.detail = 'NOT_CONNECTED'
    and lal.created_at >= v_day_start and lal.created_at < v_day_end;

  select count(*), coalesce(json_agg(json_build_object('leadName', l.name, 'time', lal.created_at) order by lal.created_at desc), '[]'::json)
  into v_switched_off, v_switched_off_details
  from lead_activity_log lal
  join leads l on l.id = lal.lead_id
  where lal.employee_id = p_employee_id
    and lal.activity_type = 'STATUS_UPDATE'
    and lal.detail = 'SWITCHED_OFF'
    and lal.created_at >= v_day_start and lal.created_at < v_day_end;

  select count(*), coalesce(json_agg(json_build_object('leadName', l.name, 'time', lal.created_at) order by lal.created_at desc), '[]'::json)
  into v_not_interested, v_not_interested_details
  from lead_activity_log lal
  join leads l on l.id = lal.lead_id
  where lal.employee_id = p_employee_id
    and lal.activity_type = 'STATUS_UPDATE'
    and lal.detail = 'NOT_INTERESTED'
    and lal.created_at >= v_day_start and lal.created_at < v_day_end;

  select count(*), coalesce(json_agg(json_build_object('leadName', l.name, 'time', lal.created_at) order by lal.created_at desc), '[]'::json)
  into v_converted, v_converted_details
  from lead_activity_log lal
  join leads l on l.id = lal.lead_id
  where lal.employee_id = p_employee_id
    and lal.activity_type = 'STATUS_UPDATE'
    and lal.detail = 'CONVERTED'
    and lal.created_at >= v_day_start and lal.created_at < v_day_end;

  select count(*), coalesce(json_agg(json_build_object('leadName', l.name, 'time', lal.created_at) order by lal.created_at desc), '[]'::json)
  into v_followups, v_followup_details
  from lead_activity_log lal
  join leads l on l.id = lal.lead_id
  where lal.employee_id = p_employee_id
    and lal.activity_type = 'BOARD_STAGE_MOVE'
    and lal.detail = 'FOLLOW_UP'
    and lal.created_at >= v_day_start and lal.created_at < v_day_end;

  select count(*), coalesce(json_agg(json_build_object('leadName', l.name, 'time', sv.created_at) order by sv.created_at desc), '[]'::json)
  into v_visits, v_visit_details
  from site_visits sv
  join leads l on l.id = sv.lead_id
  where sv.employee_id = p_employee_id
    and sv.event_type in ('VISIT', 'REVISIT')
    and sv.created_at >= v_day_start and sv.created_at < v_day_end;

  select count(*), coalesce(json_agg(json_build_object('leadName', l.name, 'time', sv.created_at) order by sv.created_at desc), '[]'::json)
  into v_bookings, v_booking_details
  from site_visits sv
  join leads l on l.id = sv.lead_id
  where sv.employee_id = p_employee_id
    and sv.event_type = 'BOOKED'
    and sv.created_at >= v_day_start and sv.created_at < v_day_end;

  select count(*), coalesce(json_agg(json_build_object(
      'leadName', sl.lead_name,
      'mobile', sl.mobile,
      'callCount', sl.call_count,
      'daysSinceLastAttempt', sl.days_since_last_attempt,
      'leadId', sl.lead_id,
      'leadHistoryId', sl.lead_history_id
    ) order by sl.days_since_last_attempt desc), '[]'::json)
  into v_stuck_leads, v_stuck_leads_details
  from stuck_leads sl
  where sl.employee_id = p_employee_id;

  -- Personal Numbers count (2026-10-01 addition) -- same day-bound
  -- count+detail shape as every other metric above, scoped to leads
  -- this employee self-added as a Personal Lead (is_personal_lead,
  -- see create_personal_lead_atomic) and created within this report's
  -- day. Deliberately excluded from buildWorkReportMessage (the
  -- shareable WhatsApp text) -- on-screen only, same treatment as
  -- Stuck Leads.
  select count(*), coalesce(json_agg(json_build_object('leadName', l.name, 'time', l.created_at) order by l.created_at desc), '[]'::json)
  into v_personal_leads, v_personal_lead_details
  from leads l
  where l.current_owner_id = p_employee_id
    and l.is_personal_lead = true
    and l.created_at >= v_day_start and l.created_at < v_day_end;

  return json_build_object(
    'calls', v_calls, 'callDetails', v_call_details,
    'connected', v_connected, 'connectedDetails', v_connected_details,
    'notConnected', v_not_connected, 'notConnectedDetails', v_not_connected_details,
    'switchedOff', v_switched_off, 'switchedOffDetails', v_switched_off_details,
    'notInterested', v_not_interested, 'notInterestedDetails', v_not_interested_details,
    'converted', v_converted, 'convertedDetails', v_converted_details,
    'followUps', v_followups, 'followUpDetails', v_followup_details,
    'visits', v_visits, 'visitDetails', v_visit_details,
    'bookings', v_bookings, 'bookingDetails', v_booking_details,
    'stuckLeads', v_stuck_leads, 'stuckLeadsDetails', v_stuck_leads_details,
    'personalLeads', v_personal_leads, 'personalLeadDetails', v_personal_lead_details
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.log_lead_update_atomic(p_lead_id uuid, p_lead_history_id uuid, p_new_status text, p_note text, p_reminder_value integer DEFAULT NULL::integer, p_reminder_unit text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_employee_id uuid;
  v_reminder_at timestamptz;
  v_first_call_at timestamptz;
  v_first_whatsapp_at timestamptz;
  v_lead_name text;
  v_employee_name text;
  v_recipient record;
  v_status text;
  v_board_stage text;
begin
  v_employee_id := current_employee_id();
  if v_employee_id is null then
    raise exception 'log_lead_update_atomic: caller is not a recognized employee';
  end if;
  if not exists (
    select 1 from leads
    where id = p_lead_id
      and current_owner_id = v_employee_id
  ) then
    raise exception 'log_lead_update_atomic: lead % is not owned by the calling employee', p_lead_id;
  end if;
  if not exists (
    select 1 from lead_history
    where id = p_lead_history_id
      and lead_id = p_lead_id
      and employee_id = v_employee_id
  ) then
    raise exception 'log_lead_update_atomic: lead_history % does not belong to the calling employee for this lead', p_lead_history_id;
  end if;

  select status, board_stage into v_status, v_board_stage from leads where id = p_lead_id;
  if is_lead_terminal(v_status, v_board_stage) then
    raise exception 'log_lead_update_atomic: lead % is already in a terminal status and cannot be updated', p_lead_id;
  end if;

  if p_new_status is not null then
    if p_new_status not in ('CONNECTED', 'NOT_CONNECTED', 'SWITCHED_OFF', 'NOT_INTERESTED', 'CONVERTED') then
      raise exception 'log_lead_update_atomic: % is not a valid employee-selectable status', p_new_status;
    end if;
    update leads
    set status = p_new_status
    where id = p_lead_id;

    -- Feeds "Not Interested Today" (and other status-outcome counts)
    -- on the Work Report (Point 4, 2026-08-19). Only reached after
    -- p_new_status has already been validated above.
    insert into lead_activity_log (lead_id, lead_history_id, employee_id, activity_type, detail)
    values (p_lead_id, p_lead_history_id, v_employee_id, 'STATUS_UPDATE', p_new_status);

    -- Meta CAPI (2026-08-19): CONNECTED or NOT_INTERESTED both mean a
    -- genuine two-way conversation happened (proves the lead wasn't
    -- junk), regardless of which direction the outcome went —
    -- NOT_CONNECTED/SWITCHED_OFF do NOT qualify, the call never
    -- connected. Own nested block with its own exception handler —
    -- a failure here must never block the real status update above.
    if p_new_status in ('CONNECTED', 'NOT_INTERESTED') then
      declare
        v_meta_lead_id text;
      begin
        select meta_lead_id into v_meta_lead_id from leads where id = p_lead_id;
        if v_meta_lead_id is not null then
          insert into meta_capi_events_log (lead_id, meta_lead_id, event_tier, meta_event_name)
          values (p_lead_id, v_meta_lead_id, 'CONNECTED', 'Contact')
          on conflict (lead_id, event_tier) do nothing;
        end if;
      exception when others then
    perform log_anomaly('log_lead_update_atomic:meta_capi_enqueue', 'error', sqlerrm, jsonb_build_object('lead_id', p_lead_id));
      end;
    end if;

    -- Meta CAPI (2026-08-21): CONVERTED tier -> InitiateCheckout.
    -- Fires the moment status becomes CONVERTED, independent of
    -- board_stage (verbal client confirmation, matches
    -- getValidNextLeadStatuses.ts — CONVERTED is selectable at any
    -- non-terminal board_stage). Deliberately a SEPARATE code path
    -- from the BOOKING/Purchase tier (log_booking_atomic) — status=
    -- CONVERTED and board_stage=BOOKING are independent facts in this
    -- system (see isLeadTerminal.ts), so this is a genuinely distinct
    -- signal, not a duplicate of Purchase. log_booking_atomic also
    -- sets status='CONVERTED' via its own separate path (never calls
    -- this function) and gets the identical hook there too, so this
    -- signal fires regardless of which action set CONVERTED.
    if p_new_status = 'CONVERTED' then
      declare
        v_meta_lead_id text;
      begin
        select meta_lead_id into v_meta_lead_id from leads where id = p_lead_id;
        if v_meta_lead_id is not null then
          insert into meta_capi_events_log (lead_id, meta_lead_id, event_tier, meta_event_name)
          values (p_lead_id, v_meta_lead_id, 'CONVERTED', 'InitiateCheckout')
          on conflict (lead_id, event_tier) do nothing;
        end if;
      exception when others then
    perform log_anomaly('log_lead_update_atomic:meta_capi_enqueue', 'error', sqlerrm, jsonb_build_object('lead_id', p_lead_id));
      end;
    end if;
  end if;
  update lead_history
  set
    outcome = coalesce(p_new_status, outcome),
    outcome_at = case when p_new_status is not null then now() else outcome_at end,
    last_activity_at = now()
  where id = p_lead_history_id;
  if p_new_status is not null then
    select first_call_at, first_whatsapp_at
    into v_first_call_at, v_first_whatsapp_at
    from lead_history
    where id = p_lead_history_id;
    if v_first_call_at is null and v_first_whatsapp_at is null then
      select name into v_lead_name from leads where id = p_lead_id;
      select name into v_employee_name from employees where id = v_employee_id;
      for v_recipient in
        select id, name from employees where role in ('admin', 'super_admin', 'sales_coordinator') and is_active = true
      loop
        insert into notification (employee_id, employee_name, title, message, type, is_read)
        values (
          v_recipient.id,
          v_recipient.name,
          'Status updated without contact-click',
          format(
            '%s marked %s as %s, without ever clicking Call or WhatsApp — %s.',
            coalesce(v_employee_name, 'An employee'),
            coalesce(v_lead_name, 'a lead'),
            p_new_status,
            to_char(now(), 'DD Mon YYYY, HH12:MI AM')
          ),
          'STATUS_UPDATE_NO_CONTACT_CLICK',
          false
        );
      end loop;
    end if;
  end if;
  if p_reminder_value is not null and (p_note is null or length(trim(p_note)) = 0) then
    raise exception 'log_lead_update_atomic: a reminder requires a note to attach it to';
  end if;
  if p_reminder_value is not null then
    if p_reminder_unit not in ('hours', 'days', 'months') then
      raise exception 'log_lead_update_atomic: % is not a valid reminder unit', p_reminder_unit;
    end if;
    v_reminder_at := now() + (p_reminder_value || ' ' || p_reminder_unit)::interval;
  end if;
  if p_note is not null and length(trim(p_note)) > 0 then
    insert into lead_notes (lead_id, lead_history_id, employee_id, note, reminder_at)
    values (p_lead_id, p_lead_history_id, v_employee_id, trim(p_note), v_reminder_at);
  end if;
end;
$function$;

-- call click: back to RETURNS void, same grants as before (authenticated, service_role; no PUBLIC/anon)
drop function public.log_call_click_atomic(uuid);
CREATE FUNCTION public.log_call_click_atomic(p_lead_history_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_last_click_at timestamptz;
  v_lead_id uuid;
begin
  select last_call_click_at, lead_id into v_last_click_at, v_lead_id
  from lead_history
  where id = p_lead_history_id
    and employee_id = current_employee_id()
    and is_active = true;

  if not found then
    raise exception 'Not authorized to log a call for this lead.';
  end if;

  -- 30-second cooldown (Point 5, unchanged from before). A second tap
  -- on the SAME lead inside 30s is a silent no-op — deliberately
  -- returns BEFORE the contact_click_log insert too, so that table
  -- and call_count can never drift apart: "Calls Today" (Point 4)
  -- only ever counts genuinely-counted calls, never spam-taps.
  if v_last_click_at is not null and now() - v_last_click_at < interval '30 seconds' then
    return;
  end if;

  update lead_history
  set first_call_at = coalesce(first_call_at, now()),
      call_count = call_count + 1,
      last_call_click_at = now(),
      last_activity_at = now()
  where id = p_lead_history_id
    and employee_id = current_employee_id()
    and is_active = true;

  -- Feeds "Calls Today" on the Work Report (Point 4, 2026-08-19).
  insert into contact_click_log (lead_id, lead_history_id, employee_id, click_type)
  values (v_lead_id, p_lead_history_id, current_employee_id(), 'CALL');
end;
$function$;
revoke all on function public.log_call_click_atomic(uuid) from public, anon;
grant execute on function public.log_call_click_atomic(uuid) to authenticated, service_role;

drop index if exists public.contact_click_log_emp_lead_time_idx;
drop index if exists public.lead_activity_log_emp_lead_time_idx;
drop index if exists public.lead_notes_emp_lead_time_idx;
alter table contact_click_log
  drop column if exists outcome_activity_id,
  drop column if exists outcome,
  drop column if exists outcome_at,
  drop column if exists gap_seconds,
  drop column if exists outcome_nudged_at;

alter table lead_engine_settings drop constraint if exists lead_engine_settings_call_quality_ranges;
alter table lead_engine_settings
  drop column if exists quick_outcome_seconds,
  drop column if exists rapid_click_seconds,
  drop column if exists outcome_window_minutes,
  drop column if exists outcome_link_minutes,
  drop column if exists burst_window_minutes,
  drop column if exists burst_min_clicks,
  drop column if exists repeat_clicks_per_day,
  drop column if exists call_quality_min_sample,
  drop column if exists call_quality_visible_to_employees,
  drop column if exists call_quality_enforced,
  drop column if exists call_quality_live_since;

notify pgrst, 'reload schema';
commit;
