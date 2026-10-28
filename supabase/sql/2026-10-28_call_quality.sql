-- 2026-10-28 — Call Quality (Phase 1, software only). NOT APPLIED — apply only after the owner's "haan".
-- Rollback: 2026-10-28_call_quality_rollback.sql
--
-- Purely additive and backward compatible with the app that is live right now:
--   * new nullable columns on contact_click_log and new settings columns (with defaults)
--   * log_call_click_atomic: same behaviour, now RETURNS the click id (old app ignores the return value)
--   * log_lead_update_atomic: same behaviour + links the new outcome to the latest open CALL click
--     (own exception block — linking can never block a status update)
--   * get_employee_work_report: every old key unchanged, new keys added
--   * new views / RPCs / two cron jobs (nudges, day-end summary) gated by settings
-- call_count is NOT touched anywhere (recycle, SLA and DataCard attempts depend on it).
-- All times are server-side now(); employees cannot write contact_click_log (RLS on, no policies).
begin;

-- ---------------------------------------------------------------- 1) settings
alter table lead_engine_settings
  add column if not exists quick_outcome_seconds integer not null default 10,
  add column if not exists rapid_click_seconds integer not null default 20,
  add column if not exists outcome_window_minutes integer not null default 30,
  add column if not exists outcome_link_minutes integer not null default 60,
  add column if not exists burst_window_minutes integer not null default 5,
  add column if not exists burst_min_clicks integer not null default 8,
  add column if not exists repeat_clicks_per_day integer not null default 4,
  add column if not exists call_quality_min_sample integer not null default 10,
  add column if not exists call_quality_visible_to_employees boolean not null default true,
  add column if not exists call_quality_enforced boolean not null default false,
  add column if not exists call_quality_live_since timestamptz;

alter table lead_engine_settings
  add constraint lead_engine_settings_call_quality_ranges check (
    quick_outcome_seconds between 1 and 600
    and rapid_click_seconds between 1 and 600
    and outcome_window_minutes between 5 and 240
    and outcome_link_minutes between 5 and 240
    and burst_window_minutes between 1 and 60
    and burst_min_clicks between 2 and 100
    and repeat_clicks_per_day between 2 and 50
    and call_quality_min_sample between 1 and 500);

-- Go-live marker: clicks before this moment have no stored link, their numbers are "Estimated".
update lead_engine_settings set call_quality_live_since = now() where id = 1 and call_quality_live_since is null;

-- ---------------------------------------------------------------- 2) click evidence columns
alter table contact_click_log
  add column if not exists outcome_activity_id uuid references lead_activity_log(id) on delete set null,
  add column if not exists outcome text,
  add column if not exists outcome_at timestamptz,
  add column if not exists gap_seconds integer,
  add column if not exists outcome_nudged_at timestamptz;

create index if not exists contact_click_log_emp_lead_time_idx on contact_click_log (employee_id, lead_id, clicked_at);
create index if not exists lead_activity_log_emp_lead_time_idx on lead_activity_log (employee_id, lead_id, created_at);
create index if not exists lead_notes_emp_lead_time_idx on lead_notes (employee_id, lead_id, created_at);

-- ---------------------------------------------------------------- 3) log_call_click_atomic: same logic, returns the click id
-- (return type change needs drop + create; done inside this transaction, so callers never see it missing)
drop function public.log_call_click_atomic(uuid);
create function public.log_call_click_atomic(p_lead_history_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_last_click_at timestamptz;
  v_lead_id uuid;
  v_click_id uuid;
begin
  select last_call_click_at, lead_id into v_last_click_at, v_lead_id
  from lead_history
  where id = p_lead_history_id
    and employee_id = current_employee_id()
    and is_active = true;

  if not found then
    raise exception 'Not authorized to log a call for this lead.';
  end if;

  -- 30-second cooldown (Point 5, unchanged). A second tap on the SAME lead inside 30s
  -- logs nothing; it returns the click that is already open so the app can still ask
  -- for that call's outcome (Call Quality, 2026-10-28).
  if v_last_click_at is not null and now() - v_last_click_at < interval '30 seconds' then
    select id into v_click_id
    from contact_click_log
    where lead_history_id = p_lead_history_id
      and employee_id = current_employee_id()
      and click_type = 'CALL'
    order by clicked_at desc
    limit 1;
    return v_click_id;
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
  values (v_lead_id, p_lead_history_id, current_employee_id(), 'CALL')
  returning id into v_click_id;

  return v_click_id;
end;
$function$;
revoke all on function public.log_call_click_atomic(uuid) from public, anon;
grant execute on function public.log_call_click_atomic(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- 4) log_lead_update_atomic (outcome -> click link)
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
  v_activity_id uuid;
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
    values (p_lead_id, p_lead_history_id, v_employee_id, 'STATUS_UPDATE', p_new_status)
    returning id into v_activity_id;

    -- Call Quality (2026-10-28): link this outcome to this employee's latest CALL click on
    -- this lead inside the link window, if that click has no outcome yet. Server time only.
    -- Own exception block: linking must never block the real status update.
    begin
      update contact_click_log c
      set outcome_activity_id = v_activity_id,
          outcome = p_new_status,
          outcome_at = now(),
          gap_seconds = extract(epoch from now() - c.clicked_at)::int
      where c.id = (
          select k.id from contact_click_log k
          where k.employee_id = v_employee_id and k.lead_id = p_lead_id and k.click_type = 'CALL'
            and k.clicked_at > now() - make_interval(mins => coalesce((select outcome_link_minutes from lead_engine_settings where id = 1), 60))
          order by k.clicked_at desc
          limit 1)
        and c.outcome_activity_id is null;
    exception when others then
      perform log_anomaly('log_lead_update_atomic:call_quality_link', 'warning', sqlerrm, jsonb_build_object('lead_id', p_lead_id));
    end;

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

-- ---------------------------------------------------------------- 5) views (flags come from here, never from the app)
-- security_invoker: anon/authenticated reading these through the API see nothing (RLS on the base
-- tables has no employee policies); the RPCs below are SECURITY DEFINER and check the caller.
create or replace view public.call_quality_clicks with (security_invoker = true) as
with s as (
  select quick_outcome_seconds quick_s, rapid_click_seconds rapid_s, outcome_window_minutes win_m,
         outcome_link_minutes link_m, burst_window_minutes burst_m, burst_min_clicks burst_n,
         repeat_clicks_per_day repeat_n, sla_office_start_time off_start, sla_office_end_time off_end,
         sla_weekly_off_day off_dow, call_quality_live_since live_since
  from lead_engine_settings where id = 1
),
b as (
  select c.id, c.lead_id, c.lead_history_id, c.employee_id, c.clicked_at,
         (c.clicked_at at time zone 'Asia/Kolkata') clicked_ist,
         c.outcome_activity_id, c.outcome, c.outcome_at, c.gap_seconds,
         extract(epoch from c.clicked_at - lag(c.clicked_at) over (partition by c.employee_id order by c.clicked_at))::int prev_click_gap_seconds,
         row_number() over (partition by c.employee_id, c.lead_id, (c.clicked_at at time zone 'Asia/Kolkata')::date order by c.clicked_at)::int nth_on_lead_today,
         lead(c.clicked_at) over (partition by c.employee_id, c.lead_id order by c.clicked_at) next_click_same_lead_at
  from contact_click_log c
  where c.click_type = 'CALL'
),
r as (
  select b.*, l.lead_type card_type, s.*,
         (b.outcome_activity_id is null and (s.live_since is null or b.clicked_at < s.live_since)) is_estimated,
         est.detail est_outcome, est.created_at est_outcome_at,
         fu.at followed_up_at, burst.n clicks_in_burst_window,
         exists (select 1 from attendance a where a.employee_id = b.employee_id and a.date = b.clicked_ist::date and a.shift_start_at is not null) shift_started
  from b
  cross join s
  join leads l on l.id = b.lead_id
  -- before go-live there is no stored link: estimate it as the first status update on that lead by that
  -- employee inside the link window and before the next call click on the same lead
  left join lateral (
    select a.detail, a.created_at
    from lead_activity_log a
    where b.outcome_activity_id is null and (s.live_since is null or b.clicked_at < s.live_since)
      and a.employee_id = b.employee_id and a.lead_id = b.lead_id and a.activity_type = 'STATUS_UPDATE'
      and a.created_at >= b.clicked_at and a.created_at < b.clicked_at + make_interval(mins => s.link_m)
      and (b.next_click_same_lead_at is null or a.created_at < b.next_click_same_lead_at)
    order by a.created_at
    limit 1
  ) est on true
  -- anything the employee did on that lead after the click: status/board move, note, or a WhatsApp click
  left join lateral (
    select least(
      (select min(a.created_at) from lead_activity_log a where a.employee_id = b.employee_id and a.lead_id = b.lead_id
         and a.created_at >= b.clicked_at and a.created_at < b.clicked_at + make_interval(mins => s.win_m)),
      (select min(n.created_at) from lead_notes n where n.employee_id = b.employee_id and n.lead_id = b.lead_id
         and n.created_at >= b.clicked_at and n.created_at < b.clicked_at + make_interval(mins => s.win_m)),
      (select min(k.clicked_at) from contact_click_log k where k.employee_id = b.employee_id and k.lead_id = b.lead_id
         and k.click_type = 'WHATSAPP' and k.clicked_at >= b.clicked_at and k.clicked_at < b.clicked_at + make_interval(mins => s.win_m))
    ) at
  ) fu on true
  left join lateral (
    select count(*)::int n from contact_click_log x
    where x.employee_id = b.employee_id and x.click_type = 'CALL'
      and x.clicked_at > b.clicked_at - make_interval(mins => s.burst_m) and x.clicked_at <= b.clicked_at
  ) burst on true
),
f as (
  select r.*,
         coalesce(r.outcome, r.est_outcome) final_outcome,
         coalesce(r.outcome_at, r.est_outcome_at) final_outcome_at,
         coalesce(r.gap_seconds, extract(epoch from r.est_outcome_at - r.clicked_at)::int) final_gap_seconds,
         (r.clicked_at > now() - make_interval(mins => r.win_m)) is_pending,
         (r.followed_up_at is null and r.next_click_same_lead_at is not null
           and r.next_click_same_lead_at < r.clicked_at + make_interval(mins => r.win_m)) is_redial,
         (r.clicked_ist::time < r.off_start or r.clicked_ist::time >= r.off_end
           or extract(dow from r.clicked_ist) = r.off_dow) outside_hours
  from r
)
select f.id click_id, f.employee_id, f.lead_id, f.lead_history_id, f.card_type,
       f.clicked_at, f.clicked_ist::date work_date,
       f.final_outcome outcome, f.final_outcome_at outcome_at, f.final_gap_seconds gap_seconds,
       f.is_estimated, f.is_pending, f.is_redial, f.followed_up_at,
       f.prev_click_gap_seconds, f.clicks_in_burst_window, f.nth_on_lead_today, f.shift_started,
       array_remove(array[
         case when f.final_gap_seconds is not null and f.final_gap_seconds < f.quick_s then 'QUICK_OUTCOME' end,
         case when not f.is_pending and not f.is_redial and f.followed_up_at is null then 'ORPHAN_CLICK' end,
         case when f.prev_click_gap_seconds < f.rapid_s then 'RAPID_CLICK' end,
         case when f.clicks_in_burst_window >= f.burst_n then 'BURST' end,
         case when f.nth_on_lead_today >= f.repeat_n then 'REPEAT_CLICKS' end,
         case when f.outside_hours then 'OUTSIDE_OFFICE_HOURS' end,
         case when not f.shift_started then 'NO_SHIFT_START' end,
         case when f.is_redial then 'REDIAL' end
       ], null) flags
from f;

-- One row per flag. OUTCOME_NO_CLICK: a status update with no CALL or WhatsApp click on that lead
-- by that employee inside the link window before it.
create or replace view public.call_quality_flags with (security_invoker = true) as
select q.click_id, null::uuid activity_id, q.employee_id, q.lead_id, q.card_type,
       q.clicked_at event_at, q.work_date, unnest(q.flags) flag
from call_quality_clicks q
union all
select null::uuid, a.id, a.employee_id, a.lead_id, l.lead_type, a.created_at,
       (a.created_at at time zone 'Asia/Kolkata')::date, 'OUTCOME_NO_CLICK'
from lead_activity_log a
join leads l on l.id = a.lead_id
cross join (select outcome_link_minutes link_m from lead_engine_settings where id = 1) s
where a.activity_type = 'STATUS_UPDATE'
  and not exists (
    select 1 from contact_click_log k
    where k.employee_id = a.employee_id and k.lead_id = a.lead_id and k.click_type in ('CALL', 'WHATSAPP')
      and k.clicked_at <= a.created_at and k.clicked_at > a.created_at - make_interval(mins => s.link_m));

revoke all on public.call_quality_clicks, public.call_quality_flags from public, anon, authenticated;

-- ---------------------------------------------------------------- 6) aggregation + score
-- Score = clean clicks / (judged clicks + outcomes without a click). Judged = not pending (younger than the
-- outcome window) and not a redial (a dropped call dialed again counts neither way). A clean click has none
-- of QUICK_OUTCOME, ORPHAN_CLICK, RAPID_CLICK, BURST, REPEAT_CLICKS. OUTSIDE_OFFICE_HOURS and NO_SHIFT_START
-- are shown but never lower the score. Below call_quality_min_sample judged events the score is null.
create or replace function public.call_quality_score(p_clean bigint, p_judged bigint, p_no_click bigint, p_min_sample integer)
returns integer language sql immutable as $$
  select case when coalesce(p_judged, 0) + coalesce(p_no_click, 0) < greatest(p_min_sample, 1) then null
              else round(100.0 * coalesce(p_clean, 0) / (coalesce(p_judged, 0) + coalesce(p_no_click, 0)))::int end
$$;

create or replace function public.call_quality_daily(p_employee_id uuid, p_from date, p_to date)
returns table (employee_id uuid, work_date date, card_type text, dial_clicks bigint, judged bigint, clean bigint,
               pending bigint, redials bigint, quick_outcome bigint, orphan_click bigint, rapid_click bigint, burst bigint,
               repeat_clicks bigint, outside_office_hours bigint, no_shift_start bigint, outcome_no_click bigint,
               logged_calls bigint, connected bigint, estimated_clicks bigint)
language sql stable security definer set search_path to 'public' as $$
  with bounds as (
    select (p_from::text || ' 00:00:00+05:30')::timestamptz t0, ((p_to + 1)::text || ' 00:00:00+05:30')::timestamptz t1
  ),
  c as (
    select q.employee_id, q.work_date, coalesce(q.card_type, 'LEAD') card_type, q.flags, q.is_pending, q.is_redial, q.is_estimated
    from call_quality_clicks q, bounds
    where (p_employee_id is null or q.employee_id = p_employee_id) and q.clicked_at >= bounds.t0 and q.clicked_at < bounds.t1
  ),
  ca as (
    select c.employee_id, c.work_date, c.card_type,
           count(*) dial_clicks,
           count(*) filter (where not c.is_pending and not c.is_redial) judged,
           count(*) filter (where not c.is_pending and not c.is_redial
                              and not (c.flags && array['QUICK_OUTCOME','ORPHAN_CLICK','RAPID_CLICK','BURST','REPEAT_CLICKS'])) clean,
           count(*) filter (where c.is_pending) pending,
           count(*) filter (where c.is_redial) redials,
           count(*) filter (where 'QUICK_OUTCOME' = any(c.flags)) quick_outcome,
           count(*) filter (where 'ORPHAN_CLICK' = any(c.flags)) orphan_click,
           count(*) filter (where 'RAPID_CLICK' = any(c.flags)) rapid_click,
           count(*) filter (where 'BURST' = any(c.flags)) burst,
           count(*) filter (where 'REPEAT_CLICKS' = any(c.flags)) repeat_clicks,
           count(*) filter (where 'OUTSIDE_OFFICE_HOURS' = any(c.flags)) outside_office_hours,
           count(*) filter (where 'NO_SHIFT_START' = any(c.flags)) no_shift_start,
           count(*) filter (where c.is_estimated) estimated_clicks
    from c group by 1, 2, 3
  ),
  o as (
    select a.employee_id, (a.created_at at time zone 'Asia/Kolkata')::date work_date, coalesce(l.lead_type, 'LEAD') card_type,
           count(*) logged_calls,
           count(*) filter (where a.detail = 'CONNECTED') connected,
           count(*) filter (where not exists (
             select 1 from contact_click_log k
             where k.employee_id = a.employee_id and k.lead_id = a.lead_id and k.click_type in ('CALL', 'WHATSAPP')
               and k.clicked_at <= a.created_at and k.clicked_at > a.created_at - make_interval(mins => s.link_m))) outcome_no_click
    from lead_activity_log a
    join leads l on l.id = a.lead_id
    cross join bounds
    cross join (select outcome_link_minutes link_m from lead_engine_settings where id = 1) s
    where a.activity_type = 'STATUS_UPDATE' and (p_employee_id is null or a.employee_id = p_employee_id)
      and a.created_at >= bounds.t0 and a.created_at < bounds.t1
    group by 1, 2, 3
  )
  select coalesce(ca.employee_id, o.employee_id), coalesce(ca.work_date, o.work_date), coalesce(ca.card_type, o.card_type),
         coalesce(ca.dial_clicks, 0), coalesce(ca.judged, 0), coalesce(ca.clean, 0), coalesce(ca.pending, 0), coalesce(ca.redials, 0),
         coalesce(ca.quick_outcome, 0), coalesce(ca.orphan_click, 0), coalesce(ca.rapid_click, 0), coalesce(ca.burst, 0),
         coalesce(ca.repeat_clicks, 0), coalesce(ca.outside_office_hours, 0), coalesce(ca.no_shift_start, 0),
         coalesce(o.outcome_no_click, 0), coalesce(o.logged_calls, 0), coalesce(o.connected, 0), coalesce(ca.estimated_clicks, 0)
  from ca full join o on o.employee_id = ca.employee_id and o.work_date = ca.work_date and o.card_type = ca.card_type
$$;
revoke all on function public.call_quality_score(bigint, bigint, bigint, integer) from public, anon;
revoke all on function public.call_quality_daily(uuid, date, date) from public, anon, authenticated;
grant execute on function public.call_quality_score(bigint, bigint, bigint, integer) to authenticated, service_role;

-- Totals json for a set of daily rows (same keys everywhere the app shows them).
create or replace function public.call_quality_totals_json(p_rows jsonb, p_min_sample integer)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'dial_clicks', coalesce(sum((x->>'dial_clicks')::bigint), 0),
    'logged_calls', coalesce(sum((x->>'logged_calls')::bigint), 0),
    'connected', coalesce(sum((x->>'connected')::bigint), 0),
    'judged', coalesce(sum((x->>'judged')::bigint), 0),
    'clean', coalesce(sum((x->>'clean')::bigint), 0),
    'pending', coalesce(sum((x->>'pending')::bigint), 0),
    'redials', coalesce(sum((x->>'redials')::bigint), 0),
    'estimated_clicks', coalesce(sum((x->>'estimated_clicks')::bigint), 0),
    'genuine_score', call_quality_score(sum((x->>'clean')::bigint)::bigint, sum((x->>'judged')::bigint)::bigint, sum((x->>'outcome_no_click')::bigint)::bigint, p_min_sample),
    'flags', jsonb_build_object(
      'quick_outcome', coalesce(sum((x->>'quick_outcome')::bigint), 0),
      'orphan_click', coalesce(sum((x->>'orphan_click')::bigint), 0),
      'outcome_no_click', coalesce(sum((x->>'outcome_no_click')::bigint), 0),
      'rapid_click', coalesce(sum((x->>'rapid_click')::bigint), 0),
      'burst', coalesce(sum((x->>'burst')::bigint), 0),
      'repeat_clicks', coalesce(sum((x->>'repeat_clicks')::bigint), 0),
      'outside_office_hours', coalesce(sum((x->>'outside_office_hours')::bigint), 0),
      'no_shift_start', coalesce(sum((x->>'no_shift_start')::bigint), 0)))
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
$$;
revoke all on function public.call_quality_totals_json(jsonb, integer) from public, anon;

-- Caller check shared by the read RPCs: privileged roles see anyone; an employee sees only
-- themself, and only while call_quality_visible_to_employees is on.
create or replace function public.call_quality_assert_access(p_employee_id uuid)
returns void language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_caller uuid := current_employee_id();
  v_role text := current_employee_role();
begin
  if v_caller is null then
    raise exception 'call quality: caller is not a recognized employee';
  end if;
  if v_role in ('admin', 'super_admin', 'sales_coordinator') then
    return;
  end if;
  if p_employee_id is null or p_employee_id <> v_caller then
    raise exception 'call quality: not authorized to view another employee''s call quality';
  end if;
  if not (select call_quality_visible_to_employees from lead_engine_settings where id = 1) then
    raise exception 'call quality: not visible to employees right now';
  end if;
end;
$$;
revoke all on function public.call_quality_assert_access(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 7) read RPCs
-- Summary for a date range: one entry per employee (all Sales employees with activity when
-- p_employee_id is null), totals, LEAD/DATA split and a per-day trend.
create or replace function public.get_call_quality_summary(p_employee_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_set lead_engine_settings%rowtype;
  v_result jsonb;
begin
  perform call_quality_assert_access(p_employee_id);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'call quality: choose a range of at most 93 days';
  end if;
  select * into v_set from lead_engine_settings where id = 1;

  with d as (
    select to_jsonb(x) j, x.employee_id, x.work_date, x.card_type from call_quality_daily(p_employee_id, p_from, p_to) x
  ),
  per_day as (
    select employee_id, work_date, jsonb_agg(j) rows from d group by 1, 2
  ),
  emp as (
    select d.employee_id,
           jsonb_agg(d.j) all_rows,
           jsonb_agg(d.j) filter (where d.card_type = 'LEAD') lead_rows,
           jsonb_agg(d.j) filter (where d.card_type = 'DATA') data_rows
    from d group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'employee_id', e.id,
           'employee_name', e.name,
           'totals', call_quality_totals_json(emp.all_rows, v_set.call_quality_min_sample),
           'by_card_type', jsonb_build_object(
              'LEAD', call_quality_totals_json(emp.lead_rows, v_set.call_quality_min_sample),
              'DATA', call_quality_totals_json(emp.data_rows, v_set.call_quality_min_sample)),
           'days', (select coalesce(jsonb_agg(jsonb_build_object('date', pd.work_date)
                        || call_quality_totals_json(pd.rows, v_set.call_quality_min_sample) order by pd.work_date), '[]'::jsonb)
                    from per_day pd where pd.employee_id = e.id)
         ) order by e.name), '[]'::jsonb)
  into v_result
  from emp join employees e on e.id = emp.employee_id;

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'live_since', v_set.call_quality_live_since,
    'estimated', v_set.call_quality_live_since is null or (p_from::text || ' 00:00:00+05:30')::timestamptz < v_set.call_quality_live_since,
    'enforced', v_set.call_quality_enforced,
    'visible_to_employees', v_set.call_quality_visible_to_employees,
    'settings', jsonb_build_object(
      'quick_outcome_seconds', v_set.quick_outcome_seconds, 'rapid_click_seconds', v_set.rapid_click_seconds,
      'outcome_window_minutes', v_set.outcome_window_minutes, 'outcome_link_minutes', v_set.outcome_link_minutes,
      'burst_window_minutes', v_set.burst_window_minutes, 'burst_min_clicks', v_set.burst_min_clicks,
      'repeat_clicks_per_day', v_set.repeat_clicks_per_day, 'min_sample', v_set.call_quality_min_sample,
      'office_start', v_set.sla_office_start_time, 'office_end', v_set.sla_office_end_time),
    'employees', v_result);
end;
$$;

-- Drill-down: every call click (and every outcome without a click) for one employee, newest first.
create or replace function public.get_call_quality_details(p_employee_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_t0 timestamptz := (p_from::text || ' 00:00:00+05:30')::timestamptz;
  v_t1 timestamptz := ((p_to + 1)::text || ' 00:00:00+05:30')::timestamptz;
  v_result jsonb;
begin
  if p_employee_id is null then
    raise exception 'call quality: pick an employee';
  end if;
  perform call_quality_assert_access(p_employee_id);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'call quality: choose a range of at most 93 days';
  end if;

  select coalesce(jsonb_agg(row_to_json(z)::jsonb order by z.at desc), '[]'::jsonb) into v_result
  from (
    select 'CLICK' kind, q.click_id, q.lead_id, l.name lead_name, q.card_type, q.clicked_at at, q.clicked_at,
           q.outcome, q.outcome_at, q.gap_seconds, q.flags, q.is_estimated estimated, q.is_pending pending
    from call_quality_clicks q join leads l on l.id = q.lead_id
    where q.employee_id = p_employee_id and q.clicked_at >= v_t0 and q.clicked_at < v_t1
    union all
    select 'OUTCOME_NO_CLICK', null, f.lead_id, l.name, f.card_type, f.event_at, null,
           a.detail, a.created_at, null, array['OUTCOME_NO_CLICK'], false, false
    from call_quality_flags f
    join lead_activity_log a on a.id = f.activity_id
    join leads l on l.id = f.lead_id
    where f.flag = 'OUTCOME_NO_CLICK' and f.employee_id = p_employee_id and f.event_at >= v_t0 and f.event_at < v_t1
    order by 6 desc
    limit 3000
  ) z;
  return v_result;
end;
$$;

revoke all on function public.get_call_quality_summary(uuid, date, date) from public, anon;
revoke all on function public.get_call_quality_details(uuid, date, date) from public, anon;
grant execute on function public.get_call_quality_summary(uuid, date, date) to authenticated, service_role;
grant execute on function public.get_call_quality_details(uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------- 8) work report: old keys unchanged + new keys
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
  v_cq jsonb;
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

  -- Call Quality (2026-10-28): new keys only, every key above is unchanged. Hidden (null) for an
  -- employee looking at their own report while call_quality_visible_to_employees is off.
  -- Own exception block: the old report must keep working even if this part fails.
  begin
    if v_caller_role in ('admin', 'super_admin', 'sales_coordinator')
       or (select call_quality_visible_to_employees from lead_engine_settings where id = 1) then
      select jsonb_build_object(
               'dial_clicks', t->'dial_clicks',
               'logged_calls', t->'logged_calls',
               'genuine_score', t->'genuine_score',
               'call_quality_flags', t->'flags',
               'call_quality_estimated', (select call_quality_live_since is null or v_day_start < call_quality_live_since from lead_engine_settings where id = 1),
               'call_quality_visible', true)
      into v_cq
      from (select call_quality_totals_json(jsonb_agg(to_jsonb(d)), (select call_quality_min_sample from lead_engine_settings where id = 1)) t
            from call_quality_daily(p_employee_id, p_date, p_date) d) x;
    else
      v_cq := jsonb_build_object('call_quality_visible', false);
    end if;
  exception when others then
    perform log_anomaly('get_employee_work_report:call_quality', 'warning', sqlerrm, jsonb_build_object('employee_id', p_employee_id));
    v_cq := jsonb_build_object('call_quality_visible', false);
  end;

  return (json_build_object(
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
  )::jsonb || coalesce(v_cq, '{}'::jsonb))::json;
end;
$function$;

-- ---------------------------------------------------------------- 9) admin settings RPC
create or replace function public.update_call_quality_settings(p_settings jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_admin() then
    raise exception 'update_call_quality_settings: admin only';
  end if;
  update lead_engine_settings set
    quick_outcome_seconds = coalesce((p_settings->>'quick_outcome_seconds')::int, quick_outcome_seconds),
    rapid_click_seconds = coalesce((p_settings->>'rapid_click_seconds')::int, rapid_click_seconds),
    outcome_window_minutes = coalesce((p_settings->>'outcome_window_minutes')::int, outcome_window_minutes),
    outcome_link_minutes = coalesce((p_settings->>'outcome_link_minutes')::int, outcome_link_minutes),
    burst_window_minutes = coalesce((p_settings->>'burst_window_minutes')::int, burst_window_minutes),
    burst_min_clicks = coalesce((p_settings->>'burst_min_clicks')::int, burst_min_clicks),
    repeat_clicks_per_day = coalesce((p_settings->>'repeat_clicks_per_day')::int, repeat_clicks_per_day),
    call_quality_min_sample = coalesce((p_settings->>'min_sample')::int, call_quality_min_sample),
    call_quality_visible_to_employees = coalesce((p_settings->>'visible_to_employees')::boolean, call_quality_visible_to_employees),
    call_quality_enforced = coalesce((p_settings->>'enforced')::boolean, call_quality_enforced),
    updated_at = now()
  where id = 1;
end;
$$;
revoke all on function public.update_call_quality_settings(jsonb) from public, anon;
grant execute on function public.update_call_quality_settings(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------- 10) nudges (in-app notifications)
-- Every 5 min in the working day: a CALL click older than the outcome window with nothing done on that
-- lead since (no status, note, WhatsApp click or later call click), lead still with that employee.
-- One notification per click; more than 3 at once for one employee become a single summary.
create or replace function public.send_call_outcome_nudges()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_set lead_engine_settings%rowtype;
  v_emp record;
  v_click record;
  v_sent integer := 0;
begin
  select * into v_set from lead_engine_settings where id = 1;
  if not v_set.call_quality_visible_to_employees or v_set.call_quality_live_since is null then
    return 0;
  end if;

  create temp table if not exists _cq_nudge (click_id uuid, employee_id uuid, lead_id uuid, lead_name text, minutes int) on commit drop;
  truncate _cq_nudge;
  insert into _cq_nudge
  select c.id, c.employee_id, c.lead_id, l.name, (extract(epoch from now() - c.clicked_at) / 60)::int
  from contact_click_log c
  join leads l on l.id = c.lead_id
  join lead_history h on h.id = c.lead_history_id and h.is_active and h.employee_id = c.employee_id
  join employees e on e.id = c.employee_id and e.is_active
  where c.click_type = 'CALL'
    and c.outcome_nudged_at is null and c.outcome_activity_id is null
    and c.clicked_at >= v_set.call_quality_live_since
    and c.clicked_at < now() - make_interval(mins => v_set.outcome_window_minutes)
    and c.clicked_at > now() - interval '3 hours'
    and not exists (select 1 from lead_activity_log a where a.employee_id = c.employee_id and a.lead_id = c.lead_id and a.created_at >= c.clicked_at)
    and not exists (select 1 from lead_notes n where n.employee_id = c.employee_id and n.lead_id = c.lead_id and n.created_at >= c.clicked_at)
    and not exists (select 1 from contact_click_log k where k.employee_id = c.employee_id and k.lead_id = c.lead_id
                      and k.clicked_at > c.clicked_at);

  for v_emp in select employee_id, count(*) n from _cq_nudge group by 1 loop
    if v_emp.n > 3 then
      insert into notification (employee_id, employee_name, title, message, type, is_read)
      select v_emp.employee_id, e.name, 'Outcomes not logged',
             format('You dialed %s leads more than %s minutes ago and have not logged an outcome. Open each lead and log what happened.',
                    v_emp.n, v_set.outcome_window_minutes),
             'CALL_OUTCOME_MISSING', false
      from employees e where e.id = v_emp.employee_id;
      v_sent := v_sent + 1;
    else
      for v_click in select * from _cq_nudge where employee_id = v_emp.employee_id loop
        insert into notification (employee_id, employee_name, title, message, type, is_read, related_lead_id)
        select v_click.employee_id, e.name, 'Outcome not logged',
               format('You dialed %s %s minutes ago and have not logged an outcome.', coalesce(v_click.lead_name, 'a lead'), v_click.minutes),
               'CALL_OUTCOME_MISSING', false, v_click.lead_id
        from employees e where e.id = v_click.employee_id;
        v_sent := v_sent + 1;
      end loop;
    end if;
  end loop;

  update contact_click_log c set outcome_nudged_at = now() from _cq_nudge n where c.id = n.click_id;
  return v_sent;
end;
$$;

-- Day-end summary (18:45 IST) to every employee who dialed today.
create or replace function public.send_call_quality_daily_summary()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_set lead_engine_settings%rowtype;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_row record;
  v_sent integer := 0;
begin
  select * into v_set from lead_engine_settings where id = 1;
  if not v_set.call_quality_visible_to_employees or v_set.call_quality_live_since is null then
    return 0;
  end if;
  for v_row in
    select d.employee_id, e.name,
           sum(d.dial_clicks) dial_clicks, sum(d.logged_calls) logged_calls,
           sum(d.quick_outcome + d.orphan_click + d.outcome_no_click + d.rapid_click + d.burst + d.repeat_clicks) flags,
           call_quality_score(sum(d.clean)::bigint, sum(d.judged)::bigint, sum(d.outcome_no_click)::bigint, v_set.call_quality_min_sample) score
    from call_quality_daily(null, v_today, v_today) d
    join employees e on e.id = d.employee_id and e.is_active
    group by 1, 2
    having sum(d.dial_clicks) > 0
  loop
    insert into notification (employee_id, employee_name, title, message, type, is_read)
    values (v_row.employee_id, v_row.name, 'Today''s call summary',
            format('Today: %s dial clicks, %s logged calls, %s flags. Call quality score: %s.',
                   v_row.dial_clicks, v_row.logged_calls, v_row.flags,
                   coalesce(v_row.score::text || '%', 'not enough calls yet')),
            'CALL_QUALITY_DAILY', false);
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$$;
revoke all on function public.send_call_outcome_nudges() from public, anon, authenticated;
revoke all on function public.send_call_quality_daily_summary() from public, anon, authenticated;

-- 10:30–20:25 IST every 5 minutes; summary 18:45 IST.
select cron.schedule('call-outcome-nudges', '*/5 5-14 * * *', 'select public.send_call_outcome_nudges()');
select cron.schedule('call-quality-daily-summary', '15 13 * * *', 'select public.send_call_quality_daily_summary()');

notify pgrst, 'reload schema';
commit;
