-- 2026-10-28 (rules revised 2026-10-29) — Call Quality (Phase 1, software only). NOT APPLIED — apply only after the owner's "haan".
-- Rollback: 2026-10-28_call_quality_rollback.sql   Tests (dry-run only): 2026-10-28_call_quality_tests.sql
--
-- Purely additive and backward compatible with the app that is live right now:
--   * new nullable columns (contact_click_log, lead_activity_log.contact_method) and settings columns with defaults
--   * log_call_click_atomic: same behaviour, now RETURNS the click id (old app ignores the return value)
--   * log_lead_update_atomic: same behaviour + optional p_contact_method ("How did you talk?") + links the outcome
--     to the latest open CALL click (own exception block — linking can never block a status update).
--     The old 6-argument call still works (new argument defaults to null).
--   * get_employee_work_report: every old key unchanged, new keys added
--   * new functions / views / RPCs / two cron jobs (reminders, day-end summary) gated by settings
-- call_count is NOT touched anywhere (recycle, SLA and DataCard attempts depend on it).
-- All times are server-side now(); employees cannot write contact_click_log (RLS on, no policies).
--
-- Rules (thresholds = lead_engine_settings columns):
--   NO_RESULT      no status / follow-up move / note / WhatsApp tap on that lead within outcome_link_minutes (60)  -> score
--   TOO_FAST       result saved too soon after the tap: CONNECTED/CONVERTED < quick_connected_seconds (25) -> score;
--                  NOT_INTERESTED < quick_not_interested_seconds (10) and any other status < outcome_floor_seconds (3) -> info
--   MANY_DIALS     tap < rapid_click_seconds (20) after the previous tap while that tap had no result yet, or
--                  burst_min_clicks (8; DATA cards burst_data_min_clicks 12) taps in burst_window_minutes (5) with fewer
--                  than burst_result_share_pct (50%) of them having a result -> score
--   NO_DIAL        status with no CALL/WhatsApp tap on that lead in the outcome_link_minutes before; declared
--                  "Customer called me / Called from another phone / WhatsApp call" never counts. Lowers the score only
--                  on a day where such outcomes are no_dial_share_pct (20%)+ of that employee's outcomes, else info
--   REPEAT_DIALS   repeat_clicks_per_day (4th)+ dial of one lead in a day -> info
--   OUTSIDE_HOURS, NO_SHIFT_START -> info;  REDIAL (same lead dialed again within the window, nothing between) -> left out
--   Score = clean judged taps / (judged taps + score-counted NO_DIAL); null below score_min_clicks (30) taps in the range.
--   LEAD and DATA cards are scored separately.
begin;

-- ---------------------------------------------------------------- 1) settings
alter table lead_engine_settings
  add column if not exists outcome_link_minutes integer not null default 60,
  add column if not exists reminder_after_minutes integer not null default 30,
  add column if not exists quick_connected_seconds integer not null default 25,
  add column if not exists quick_not_interested_seconds integer not null default 10,
  add column if not exists outcome_floor_seconds integer not null default 3,
  add column if not exists rapid_click_seconds integer not null default 20,
  add column if not exists burst_window_minutes integer not null default 5,
  add column if not exists burst_min_clicks integer not null default 8,
  add column if not exists burst_data_min_clicks integer not null default 12,
  add column if not exists burst_result_share_pct integer not null default 50,
  add column if not exists repeat_clicks_per_day integer not null default 4,
  add column if not exists no_dial_share_pct integer not null default 20,
  add column if not exists declared_other_share_pct integer not null default 20,
  add column if not exists score_min_clicks integer not null default 30,
  add column if not exists call_quality_visible_to_employees boolean not null default true,
  add column if not exists call_quality_enforced boolean not null default false,
  add column if not exists call_quality_share_line boolean not null default true,
  add column if not exists call_quality_live_since timestamptz;

alter table lead_engine_settings
  add constraint lead_engine_settings_call_quality_ranges check (
    outcome_link_minutes between 10 and 240
    and reminder_after_minutes between 5 and 240 and reminder_after_minutes <= outcome_link_minutes
    and quick_connected_seconds between 1 and 600
    and quick_not_interested_seconds between 1 and 600
    and outcome_floor_seconds between 0 and 60
    and rapid_click_seconds between 1 and 600
    and burst_window_minutes between 1 and 60
    and burst_min_clicks between 2 and 100
    and burst_data_min_clicks between 2 and 100
    and burst_result_share_pct between 0 and 100
    and repeat_clicks_per_day between 2 and 50
    and no_dial_share_pct between 0 and 100
    and declared_other_share_pct between 0 and 100
    and score_min_clicks between 1 and 1000);

-- Go-live marker: clicks before this moment have no stored link; their numbers are "Estimated".
update lead_engine_settings set call_quality_live_since = now() where id = 1 and call_quality_live_since is null;

-- ---------------------------------------------------------------- 2) evidence columns
alter table contact_click_log
  add column if not exists outcome_activity_id uuid references lead_activity_log(id) on delete set null,
  add column if not exists outcome text,
  add column if not exists outcome_at timestamptz,
  add column if not exists gap_seconds integer,
  add column if not exists outcome_nudged_at timestamptz;

-- "How did you talk?" chip on the outcome sheet. null = old app / not asked (treated as "Called from CRM").
-- Saved on the outcome row itself, so its time is the row's server created_at.
alter table lead_activity_log
  add column if not exists contact_method text
    constraint lead_activity_log_contact_method_check
    check (contact_method in ('CRM_CALL', 'CUSTOMER_CALLED', 'OTHER_PHONE', 'WHATSAPP_CALL'));

create index if not exists contact_click_log_emp_lead_time_idx on contact_click_log (employee_id, lead_id, clicked_at);
create index if not exists lead_activity_log_emp_lead_time_idx on lead_activity_log (employee_id, lead_id, created_at);
create index if not exists lead_notes_emp_lead_time_idx on lead_notes (employee_id, lead_id, created_at);

-- ---------------------------------------------------------------- 3) log_call_click_atomic: same logic, returns the click id
-- (return type change needs drop + create; inside this transaction, so callers never see it missing)
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
  -- for that call's result (Call Quality, 2026-10-28).
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

-- ---------------------------------------------------------------- 4) log_lead_update_atomic (+ p_contact_method, outcome -> click link)
-- New optional argument means a new signature: drop the 6-argument one and create the 7-argument one in the same
-- transaction (an overload pair would make PostgREST's named-argument call ambiguous). Same grants as before.
drop function public.log_lead_update_atomic(uuid, uuid, text, text, integer, text);
CREATE FUNCTION public.log_lead_update_atomic(p_lead_id uuid, p_lead_history_id uuid, p_new_status text, p_note text, p_reminder_value integer DEFAULT NULL::integer, p_reminder_unit text DEFAULT NULL::text, p_contact_method text DEFAULT NULL::text)
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
    -- Call Quality (2026-10-29): "How did you talk?" chip; null = not asked (old app).
    if p_contact_method is not null and p_contact_method not in ('CRM_CALL', 'CUSTOMER_CALLED', 'OTHER_PHONE', 'WHATSAPP_CALL') then
      raise exception 'log_lead_update_atomic: % is not a valid contact method', p_contact_method;
    end if;
    update leads
    set status = p_new_status
    where id = p_lead_id;

    -- Feeds "Not Interested Today" (and other status-outcome counts)
    -- on the Work Report (Point 4, 2026-08-19). Only reached after
    -- p_new_status has already been validated above.
    insert into lead_activity_log (lead_id, lead_history_id, employee_id, activity_type, detail, contact_method)
    values (p_lead_id, p_lead_history_id, v_employee_id, 'STATUS_UPDATE', p_new_status, p_contact_method)
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
grant execute on function public.log_lead_update_atomic(uuid, uuid, text, text, integer, text, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- 5) per-call rows (every flag comes from here, never from the app)
-- Bounded by employee and time so the RPCs stay fast; reads 1 day before p_from (previous tap, burst, repeat count)
-- and one window after p_to (redial check). Only rows with p_from <= clicked_at < p_to are returned.
create or replace function public.call_quality_click_rows(p_employee_id uuid, p_from timestamptz, p_to timestamptz)
returns table (
  click_id uuid, employee_id uuid, lead_id uuid, lead_history_id uuid, card_type text, clicked_at timestamptz, work_date date,
  outcome text, outcome_at timestamptz, gap_seconds integer, contact_method text, result_kind text, result_at timestamptz,
  is_estimated boolean, is_pending boolean, is_redial boolean,
  prev_click_gap_seconds integer, prev_click_had_result boolean, burst_clicks integer, burst_with_result integer,
  nth_on_lead_today integer, shift_started boolean, flags text[], score_flags text[])
language sql stable security definer set search_path to 'public' as $$
with s as (
  select outcome_link_minutes link_m, quick_connected_seconds q_conn, quick_not_interested_seconds q_ni,
         outcome_floor_seconds q_floor, rapid_click_seconds rapid_s, burst_window_minutes burst_m,
         burst_min_clicks burst_n, burst_data_min_clicks burst_data_n, burst_result_share_pct burst_pct,
         repeat_clicks_per_day repeat_n, sla_office_start_time off_start, sla_office_end_time off_end,
         sla_weekly_off_day off_dow, call_quality_live_since live_since
  from lead_engine_settings where id = 1
),
b as (
  select c.id, c.lead_id, c.lead_history_id, c.employee_id, c.clicked_at,
         (c.clicked_at at time zone 'Asia/Kolkata') clicked_ist,
         c.outcome_activity_id, c.outcome, c.outcome_at, c.gap_seconds,
         row_number() over (partition by c.employee_id, c.lead_id, (c.clicked_at at time zone 'Asia/Kolkata')::date order by c.clicked_at)::int nth_on_lead_today,
         lead(c.clicked_at) over (partition by c.employee_id, c.lead_id order by c.clicked_at) next_click_same_lead_at
  from contact_click_log c cross join s
  where c.click_type = 'CALL' and (p_employee_id is null or c.employee_id = p_employee_id)
    and c.clicked_at >= p_from - interval '1 day' and c.clicked_at < p_to + make_interval(mins => s.link_m)
),
r as (
  select b.*, coalesce(l.lead_type, 'LEAD') card_type,
         (b.outcome_activity_id is null and (s.live_since is null or b.clicked_at < s.live_since)) is_estimated,
         coalesce(b.outcome, est.detail) final_outcome,
         coalesce(b.outcome_at, est.created_at) final_outcome_at,
         coalesce(b.gap_seconds, extract(epoch from est.created_at - b.clicked_at)::int) final_gap,
         coalesce(la.contact_method, est.contact_method) contact_method,
         res.at result_at, res.kind result_kind,
         exists (select 1 from attendance a where a.employee_id = b.employee_id and a.date = b.clicked_ist::date and a.shift_start_at is not null) shift_started,
         (b.clicked_ist::time < s.off_start or b.clicked_ist::time >= s.off_end or extract(dow from b.clicked_ist) = s.off_dow) outside_hours
  from b
  cross join s
  join leads l on l.id = b.lead_id
  left join lead_activity_log la on la.id = b.outcome_activity_id
  -- before go-live there is no stored link: estimate it as the first status on that lead by that employee
  -- inside the window and before the next tap on the same lead
  left join lateral (
    select a.detail, a.created_at, a.contact_method
    from lead_activity_log a
    where b.outcome_activity_id is null and (s.live_since is null or b.clicked_at < s.live_since)
      and a.employee_id = b.employee_id and a.lead_id = b.lead_id and a.activity_type = 'STATUS_UPDATE'
      and a.created_at >= b.clicked_at and a.created_at < b.clicked_at + make_interval(mins => s.link_m)
      and (b.next_click_same_lead_at is null or a.created_at < b.next_click_same_lead_at)
    order by a.created_at
    limit 1
  ) est on true
  -- first "result" on that lead after the tap: status, follow-up move, note, or a WhatsApp tap
  left join lateral (
    select z.at, z.kind from (
      select a.created_at at, case when a.activity_type = 'STATUS_UPDATE' then 'STATUS' else 'FOLLOW_UP' end kind
      from lead_activity_log a
      where a.employee_id = b.employee_id and a.lead_id = b.lead_id
        and a.created_at >= b.clicked_at and a.created_at < b.clicked_at + make_interval(mins => s.link_m)
      union all
      select n.created_at, 'NOTE' from lead_notes n
      where n.employee_id = b.employee_id and n.lead_id = b.lead_id
        and n.created_at >= b.clicked_at and n.created_at < b.clicked_at + make_interval(mins => s.link_m)
      union all
      select k.clicked_at, 'WHATSAPP' from contact_click_log k
      where k.employee_id = b.employee_id and k.lead_id = b.lead_id and k.click_type = 'WHATSAPP'
        and k.clicked_at >= b.clicked_at and k.clicked_at < b.clicked_at + make_interval(mins => s.link_m)
    ) z
    order by z.at
    limit 1
  ) res on true
),
q as (
  select r.*,
         case when r.card_type = 'DATA' then s.burst_data_n else s.burst_n end burst_need,
         lag(r.clicked_at) over w prev_clicked_at,
         lag(r.result_at) over w prev_result_at,
         sum(case when r.result_at is not null then 1 else 0 end) over (w rows between unbounded preceding and current row) cum_results
  from r cross join s
  window w as (partition by r.employee_id order by r.clicked_at, r.id)
),
q2 as (
  -- burst = the last burst_need taps (this one included) all fall inside burst_window_minutes
  select q.*,
         lag(q.clicked_at, q.burst_need - 1) over w first_of_burst_at,
         q.cum_results - coalesce(lag(q.cum_results, q.burst_need) over w, 0) burst_results
  from q
  window w as (partition by q.employee_id order by q.clicked_at, q.id)
),
f as (
  select q2.*, s.*,
         (q2.clicked_at > now() - make_interval(mins => s.link_m)) is_pending,
         (q2.result_at is null and q2.next_click_same_lead_at is not null
            and q2.next_click_same_lead_at < q2.clicked_at + make_interval(mins => s.link_m)) is_redial,
         extract(epoch from q2.clicked_at - q2.prev_clicked_at)::int prev_gap,
         (q2.prev_result_at is not null and q2.prev_result_at <= q2.clicked_at) prev_had_result,
         (q2.first_of_burst_at is not null and q2.first_of_burst_at > q2.clicked_at - make_interval(mins => s.burst_m)) in_burst,
         case when q2.final_outcome in ('CONNECTED', 'CONVERTED') then s.q_conn
              when q2.final_outcome = 'NOT_INTERESTED' then s.q_ni
              else s.q_floor end too_fast_limit
  from q2 cross join s
),
g as (
  select f.*,
         (not f.is_pending and not f.is_redial and f.result_at is null) no_result,
         (f.final_gap is not null and f.final_gap < f.too_fast_limit) too_fast,
         (f.final_gap is not null and f.final_gap < f.too_fast_limit and f.final_outcome in ('CONNECTED', 'CONVERTED')) too_fast_scored,
         ((f.prev_gap < f.rapid_s and not f.prev_had_result)
          or (not f.is_pending and f.in_burst and f.burst_results * 100 < f.burst_pct * f.burst_need)) many_dials
  from f
)
select g.id, g.employee_id, g.lead_id, g.lead_history_id, g.card_type, g.clicked_at, g.clicked_ist::date,
       g.final_outcome, g.final_outcome_at, g.final_gap, g.contact_method, g.result_kind, g.result_at,
       g.is_estimated, g.is_pending, g.is_redial,
       g.prev_gap, g.prev_had_result,
       case when g.in_burst then g.burst_need end, case when g.in_burst then g.burst_results::int end,
       g.nth_on_lead_today, g.shift_started,
       array_remove(array[
         case when g.no_result then 'NO_RESULT' end,
         case when g.too_fast then 'TOO_FAST' end,
         case when g.many_dials then 'MANY_DIALS' end,
         case when g.nth_on_lead_today >= g.repeat_n then 'REPEAT_DIALS' end,
         case when g.outside_hours then 'OUTSIDE_HOURS' end,
         case when not g.shift_started then 'NO_SHIFT_START' end,
         case when g.is_redial then 'REDIAL' end
       ], null),
       array_remove(array[
         case when g.no_result then 'NO_RESULT' end,
         case when g.too_fast_scored then 'TOO_FAST' end,
         case when g.many_dials then 'MANY_DIALS' end
       ], null)
from g
where g.clicked_at >= p_from and g.clicked_at < p_to
$$;

-- Every status outcome in the range, with whether a CRM tap came before it (NO_DIAL) and whether the employee
-- declared another way of talking (never counted as NO_DIAL).
create or replace function public.call_quality_outcome_rows(p_employee_id uuid, p_from timestamptz, p_to timestamptz)
returns table (activity_id uuid, employee_id uuid, lead_id uuid, card_type text, at timestamptz, work_date date,
               outcome text, contact_method text, declared_other boolean, no_dial boolean)
language sql stable security definer set search_path to 'public' as $$
  select a.id, a.employee_id, a.lead_id, coalesce(l.lead_type, 'LEAD'), a.created_at, (a.created_at at time zone 'Asia/Kolkata')::date,
         a.detail, a.contact_method,
         coalesce(a.contact_method in ('CUSTOMER_CALLED', 'OTHER_PHONE'), false),
         (coalesce(a.contact_method, 'CRM_CALL') = 'CRM_CALL' and not exists (
            select 1 from contact_click_log k
            where k.employee_id = a.employee_id and k.lead_id = a.lead_id and k.click_type in ('CALL', 'WHATSAPP')
              and k.clicked_at <= a.created_at and k.clicked_at > a.created_at - make_interval(mins => s.link_m)))
  from lead_activity_log a
  join leads l on l.id = a.lead_id
  cross join (select outcome_link_minutes link_m from lead_engine_settings where id = 1) s
  where a.activity_type = 'STATUS_UPDATE' and (p_employee_id is null or a.employee_id = p_employee_id)
    and a.created_at >= p_from and a.created_at < p_to
$$;

-- Transparency views (whole history; slower — the app uses the bounded functions).
create or replace view public.call_quality_clicks with (security_invoker = true) as
select * from call_quality_click_rows(null, '-infinity'::timestamptz, 'infinity'::timestamptz);
create or replace view public.call_quality_flags with (security_invoker = true) as
select q.click_id, null::uuid activity_id, q.employee_id, q.lead_id, q.card_type, q.clicked_at event_at, q.work_date,
       unnest(q.flags) flag
from call_quality_clicks q
union all
select null::uuid, o.activity_id, o.employee_id, o.lead_id, o.card_type, o.at, o.work_date, 'NO_DIAL'
from call_quality_outcome_rows(null, '-infinity'::timestamptz, 'infinity'::timestamptz) o
where o.no_dial;
revoke all on public.call_quality_clicks, public.call_quality_flags from public, anon, authenticated;

-- ---------------------------------------------------------------- 6) aggregation + score
create or replace function public.call_quality_score(p_clean bigint, p_judged bigint, p_no_dial_scored bigint, p_dials bigint, p_min_clicks integer)
returns integer language sql immutable as $$
  select case when coalesce(p_dials, 0) < greatest(p_min_clicks, 1)
                or coalesce(p_judged, 0) + coalesce(p_no_dial_scored, 0) = 0 then null
              else round(100.0 * coalesce(p_clean, 0) / (coalesce(p_judged, 0) + coalesce(p_no_dial_scored, 0)))::int end
$$;
-- Traffic light. Same bands as lib/callQuality.ts (checked by scripts/check-call-quality.js).
create or replace function public.call_quality_band(p_score integer)
returns text language sql immutable as $$
  select case when p_score is null then null when p_score >= 80 then 'Green' when p_score >= 60 then 'Amber' else 'Red' end
$$;

create or replace function public.call_quality_daily(p_employee_id uuid, p_from date, p_to date)
returns table (employee_id uuid, work_date date, card_type text, dial_clicks bigint, judged bigint, clean bigint,
               pending bigint, redials bigint, results_saved bigint, no_result bigint, too_fast bigint, too_fast_scored bigint,
               many_dials bigint, repeat_dials bigint, outside_hours bigint, no_shift_start bigint,
               logged_calls bigint, connected bigint, no_dial bigint, no_dial_scored bigint, declared_other bigint,
               estimated_clicks bigint)
language sql stable security definer set search_path to 'public' as $$
  with bounds as (
    select (p_from::text || ' 00:00:00+05:30')::timestamptz t0, ((p_to + 1)::text || ' 00:00:00+05:30')::timestamptz t1
  ),
  c as (select x.* from bounds, call_quality_click_rows(p_employee_id, bounds.t0, bounds.t1) x),
  ca as (
    select c.employee_id, c.work_date, c.card_type,
           count(*) dial_clicks,
           count(*) filter (where not c.is_pending and not c.is_redial) judged,
           count(*) filter (where not c.is_pending and not c.is_redial and cardinality(c.score_flags) = 0) clean,
           count(*) filter (where c.is_pending) pending,
           count(*) filter (where c.is_redial) redials,
           count(*) filter (where c.result_at is not null) results_saved,
           count(*) filter (where 'NO_RESULT' = any(c.flags)) no_result,
           count(*) filter (where 'TOO_FAST' = any(c.flags)) too_fast,
           count(*) filter (where 'TOO_FAST' = any(c.score_flags)) too_fast_scored,
           count(*) filter (where 'MANY_DIALS' = any(c.flags)) many_dials,
           count(*) filter (where 'REPEAT_DIALS' = any(c.flags)) repeat_dials,
           count(*) filter (where 'OUTSIDE_HOURS' = any(c.flags)) outside_hours,
           count(*) filter (where 'NO_SHIFT_START' = any(c.flags)) no_shift_start,
           count(*) filter (where c.is_estimated) estimated_clicks
    from c group by 1, 2, 3
  ),
  o as (select x.* from bounds, call_quality_outcome_rows(p_employee_id, bounds.t0, bounds.t1) x),
  -- NO_DIAL lowers the score only on a day where it is a pattern (no_dial_share_pct of that day's outcomes)
  od as (
    select o.employee_id, o.work_date,
           count(*) filter (where o.no_dial) * 100 >= (select no_dial_share_pct from lead_engine_settings where id = 1) * count(*)
             and count(*) filter (where o.no_dial) > 0 pattern
    from o group by 1, 2
  ),
  oa as (
    select o.employee_id, o.work_date, o.card_type,
           count(*) logged_calls,
           count(*) filter (where o.outcome = 'CONNECTED') connected,
           count(*) filter (where o.no_dial) no_dial,
           count(*) filter (where o.no_dial and od.pattern) no_dial_scored,
           count(*) filter (where o.declared_other) declared_other
    from o join od on od.employee_id = o.employee_id and od.work_date = o.work_date
    group by 1, 2, 3
  )
  select coalesce(ca.employee_id, oa.employee_id), coalesce(ca.work_date, oa.work_date), coalesce(ca.card_type, oa.card_type),
         coalesce(ca.dial_clicks, 0), coalesce(ca.judged, 0), coalesce(ca.clean, 0), coalesce(ca.pending, 0), coalesce(ca.redials, 0),
         coalesce(ca.results_saved, 0), coalesce(ca.no_result, 0), coalesce(ca.too_fast, 0), coalesce(ca.too_fast_scored, 0),
         coalesce(ca.many_dials, 0), coalesce(ca.repeat_dials, 0), coalesce(ca.outside_hours, 0), coalesce(ca.no_shift_start, 0),
         coalesce(oa.logged_calls, 0), coalesce(oa.connected, 0), coalesce(oa.no_dial, 0), coalesce(oa.no_dial_scored, 0),
         coalesce(oa.declared_other, 0), coalesce(ca.estimated_clicks, 0)
  from ca full join oa on oa.employee_id = ca.employee_id and oa.work_date = ca.work_date and oa.card_type = ca.card_type
$$;

-- Totals json for a set of daily rows (same keys everywhere the app shows them).
create or replace function public.call_quality_totals_json(p_rows jsonb, p_min_clicks integer)
returns jsonb language sql immutable as $$
  with t as (
    select coalesce(sum((x->>'dial_clicks')::bigint), 0)::bigint dial_clicks,
           coalesce(sum((x->>'judged')::bigint), 0)::bigint judged,
           coalesce(sum((x->>'clean')::bigint), 0)::bigint clean,
           coalesce(sum((x->>'no_dial_scored')::bigint), 0)::bigint no_dial_scored,
           coalesce(sum((x->>'logged_calls')::bigint), 0)::bigint logged_calls,
           coalesce(sum((x->>'declared_other')::bigint), 0)::bigint declared_other,
           jsonb_build_object(
             'dial_clicks', coalesce(sum((x->>'dial_clicks')::bigint), 0),
             'results_saved', coalesce(sum((x->>'results_saved')::bigint), 0),
             'logged_calls', coalesce(sum((x->>'logged_calls')::bigint), 0),
             'connected', coalesce(sum((x->>'connected')::bigint), 0),
             'judged', coalesce(sum((x->>'judged')::bigint), 0),
             'clean', coalesce(sum((x->>'clean')::bigint), 0),
             'pending', coalesce(sum((x->>'pending')::bigint), 0),
             'redials', coalesce(sum((x->>'redials')::bigint), 0),
             'estimated_clicks', coalesce(sum((x->>'estimated_clicks')::bigint), 0),
             'declared_other', coalesce(sum((x->>'declared_other')::bigint), 0),
             'too_fast_scored', coalesce(sum((x->>'too_fast_scored')::bigint), 0),
             'no_dial_scored', coalesce(sum((x->>'no_dial_scored')::bigint), 0),
             'flags', jsonb_build_object(
               'no_result', coalesce(sum((x->>'no_result')::bigint), 0),
               'too_fast', coalesce(sum((x->>'too_fast')::bigint), 0),
               'many_dials', coalesce(sum((x->>'many_dials')::bigint), 0),
               'no_dial', coalesce(sum((x->>'no_dial')::bigint), 0),
               'repeat_dials', coalesce(sum((x->>'repeat_dials')::bigint), 0),
               'outside_hours', coalesce(sum((x->>'outside_hours')::bigint), 0),
               'no_shift_start', coalesce(sum((x->>'no_shift_start')::bigint), 0))) j
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
  )
  select t.j || jsonb_build_object(
           'genuine_score', call_quality_score(t.clean, t.judged, t.no_dial_scored, t.dial_clicks, p_min_clicks),
           'band', call_quality_band(call_quality_score(t.clean, t.judged, t.no_dial_scored, t.dial_clicks, p_min_clicks)))
  from t
$$;
revoke all on function public.call_quality_click_rows(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.call_quality_outcome_rows(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.call_quality_daily(uuid, date, date) from public, anon, authenticated;
revoke all on function public.call_quality_score(bigint, bigint, bigint, bigint, integer) from public, anon;
revoke all on function public.call_quality_band(integer) from public, anon;
revoke all on function public.call_quality_totals_json(jsonb, integer) from public, anon;

-- Score of one employee over the 7 days ending p_date, per card type, plus the card type with more dials.
create or replace function public.call_quality_week(p_employee_id uuid, p_date date)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with d as (select to_jsonb(x) j, x.card_type from call_quality_daily(p_employee_id, p_date - 6, p_date) x),
  m as (select score_min_clicks from lead_engine_settings where id = 1),
  t as (
    select call_quality_totals_json((select jsonb_agg(j) from d where card_type = 'LEAD'), m.score_min_clicks) lead,
           call_quality_totals_json((select jsonb_agg(j) from d where card_type = 'DATA'), m.score_min_clicks) data
    from m
  )
  select jsonb_build_object('LEAD', t.lead, 'DATA', t.data,
           'main', case when (t.data->>'dial_clicks')::int > (t.lead->>'dial_clicks')::int then 'DATA' else 'LEAD' end)
  from t
$$;
revoke all on function public.call_quality_week(uuid, date) from public, anon, authenticated;

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

create or replace function public.call_quality_settings_json()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'outcome_link_minutes', outcome_link_minutes, 'reminder_after_minutes', reminder_after_minutes,
    'quick_connected_seconds', quick_connected_seconds, 'quick_not_interested_seconds', quick_not_interested_seconds,
    'outcome_floor_seconds', outcome_floor_seconds, 'rapid_click_seconds', rapid_click_seconds,
    'burst_window_minutes', burst_window_minutes, 'burst_min_clicks', burst_min_clicks,
    'burst_data_min_clicks', burst_data_min_clicks, 'burst_result_share_pct', burst_result_share_pct,
    'repeat_clicks_per_day', repeat_clicks_per_day, 'no_dial_share_pct', no_dial_share_pct,
    'declared_other_share_pct', declared_other_share_pct, 'score_min_clicks', score_min_clicks,
    'office_start', sla_office_start_time, 'office_end', sla_office_end_time,
    'live_since', call_quality_live_since, 'enforced', call_quality_enforced,
    'visible_to_employees', call_quality_visible_to_employees, 'share_line', call_quality_share_line)
  from lead_engine_settings where id = 1
$$;
revoke all on function public.call_quality_settings_json() from public, anon, authenticated;

-- ---------------------------------------------------------------- 7) read RPCs
-- Summary for a date range: one entry per employee with activity (all when p_employee_id is null),
-- totals, LEAD/DATA split (scored separately) and a per-day trend.
create or replace function public.get_call_quality_summary(p_employee_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_set jsonb;
  v_min int;
  v_result jsonb;
begin
  perform call_quality_assert_access(p_employee_id);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'call quality: choose a range of at most 93 days';
  end if;
  v_set := call_quality_settings_json();
  v_min := (v_set->>'score_min_clicks')::int;

  with d as (
    select to_jsonb(x) j, x.employee_id, x.work_date, x.card_type from call_quality_daily(p_employee_id, p_from, p_to) x
  ),
  per_day as (select employee_id, work_date, jsonb_agg(j) rows from d group by 1, 2),
  emp as (
    select d.employee_id,
           jsonb_agg(d.j) all_rows,
           jsonb_agg(d.j) filter (where d.card_type = 'LEAD') lead_rows,
           jsonb_agg(d.j) filter (where d.card_type = 'DATA') data_rows,
           count(distinct d.work_date) filter (where (d.j->>'no_dial_scored')::int > 0) no_dial_pattern_days
    from d group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'employee_id', e.id,
           'employee_name', e.name,
           'totals', tot.j,
           'by_card_type', jsonb_build_object(
              'LEAD', call_quality_totals_json(emp.lead_rows, v_min),
              'DATA', call_quality_totals_json(emp.data_rows, v_min)),
           'no_dial_pattern_days', emp.no_dial_pattern_days,
           'declared_other_high', (tot.j->>'logged_calls')::int > 0
              and (tot.j->>'declared_other')::int * 100 >= (v_set->>'declared_other_share_pct')::int * (tot.j->>'logged_calls')::int,
           -- daily trend: score of each day on its own (no minimum, shown as a trend only)
           'days', (select coalesce(jsonb_agg(jsonb_build_object('date', pd.work_date) || call_quality_totals_json(pd.rows, 1) order by pd.work_date), '[]'::jsonb)
                    from per_day pd where pd.employee_id = e.id)
         ) order by e.name), '[]'::jsonb)
  into v_result
  from emp
  join employees e on e.id = emp.employee_id
  cross join lateral (select call_quality_totals_json(emp.all_rows, v_min) j) tot;

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'live_since', v_set->'live_since',
    'estimated', v_set->>'live_since' is null or (p_from::text || ' 00:00:00+05:30')::timestamptz < (v_set->>'live_since')::timestamptz,
    'enforced', (v_set->>'enforced')::boolean,
    'visible_to_employees', (v_set->>'visible_to_employees')::boolean,
    'settings', v_set,
    'employees', v_result);
end;
$$;

-- Call-by-call timeline for one employee (Admin drill-down, Dispute view, employee "My day"), oldest first.
create or replace function public.get_call_quality_details(p_employee_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_t0 timestamptz := (p_from::text || ' 00:00:00+05:30')::timestamptz;
  v_t1 timestamptz := ((p_to + 1)::text || ' 00:00:00+05:30')::timestamptz;
  v_rows jsonb;
begin
  if p_employee_id is null then
    raise exception 'call quality: pick an employee';
  end if;
  perform call_quality_assert_access(p_employee_id);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'call quality: choose a range of at most 93 days';
  end if;

  with o as (select * from call_quality_outcome_rows(p_employee_id, v_t0, v_t1)),
  od as (
    select o.work_date,
           count(*) filter (where o.no_dial) * 100 >= (select no_dial_share_pct from lead_engine_settings where id = 1) * count(*) pattern
    from o group by 1
  )
  select coalesce(jsonb_agg(row_to_json(z)::jsonb order by z.at), '[]'::jsonb) into v_rows
  from (
    select * from (
      select 'CLICK' kind, q.click_id, q.lead_id, l.name lead_name, q.card_type, q.clicked_at at, q.clicked_at,
             q.outcome, q.outcome_at, q.gap_seconds, q.contact_method, q.result_kind, q.result_at,
             q.flags, q.score_flags, q.is_estimated estimated, q.is_pending pending,
             q.prev_click_gap_seconds, q.prev_click_had_result, q.burst_clicks, q.burst_with_result, q.nth_on_lead_today
      from call_quality_click_rows(p_employee_id, v_t0, v_t1) q
      join leads l on l.id = q.lead_id
      union all
      select 'NO_DIAL', null, o.lead_id, l.name, o.card_type, o.at, null,
             o.outcome, o.at, null, o.contact_method, 'STATUS', o.at,
             array['NO_DIAL'], case when od.pattern then array['NO_DIAL'] else array[]::text[] end, false, false,
             null, null, null, null, null
      from o join leads l on l.id = o.lead_id join od on od.work_date = o.work_date
      where o.no_dial
    ) u
    order by u.at desc
    limit 3000
  ) z;

  return jsonb_build_object(
    'employee_id', p_employee_id,
    'employee_name', (select name from employees where id = p_employee_id),
    'from', p_from, 'to', p_to,
    'settings', call_quality_settings_json(),
    'rows', v_rows);
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

  -- Call Quality (2026-10-28): new keys only, every key above is unchanged. genuine_score = last 7 days, card type with more dials. Hidden (null) for an
  -- employee looking at their own report while call_quality_visible_to_employees is off.
  -- Own exception block: the old report must keep working even if this part fails.
  begin
    if v_caller_role in ('admin', 'super_admin', 'sales_coordinator')
       or (select call_quality_visible_to_employees from lead_engine_settings where id = 1) then
      select jsonb_build_object(
               'dial_clicks', x.t->'dial_clicks',
               'results_saved', x.t->'results_saved',
               'logged_calls', x.t->'logged_calls',
               'call_quality_flags', x.t->'flags',
               'genuine_score', w.wk->(w.wk->>'main')->'genuine_score',
               'genuine_score_band', w.wk->(w.wk->>'main')->'band',
               'genuine_score_card', w.wk->'main',
               'genuine_score_lead_7d', w.wk->'LEAD'->'genuine_score',
               'genuine_score_data_7d', w.wk->'DATA'->'genuine_score',
               'call_quality_estimated', (select call_quality_live_since is null or v_day_start - interval '6 days' < call_quality_live_since from lead_engine_settings where id = 1),
               'call_quality_visible', true,
               'call_quality_share_line', (select call_quality_share_line from lead_engine_settings where id = 1))
      into v_cq
      from (select call_quality_totals_json(jsonb_agg(to_jsonb(d)), 1) t from call_quality_daily(p_employee_id, p_date, p_date) d) x,
           (select call_quality_week(p_employee_id, p_date) wk) w;
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
    outcome_link_minutes = coalesce((p_settings->>'outcome_link_minutes')::int, outcome_link_minutes),
    reminder_after_minutes = coalesce((p_settings->>'reminder_after_minutes')::int, reminder_after_minutes),
    quick_connected_seconds = coalesce((p_settings->>'quick_connected_seconds')::int, quick_connected_seconds),
    quick_not_interested_seconds = coalesce((p_settings->>'quick_not_interested_seconds')::int, quick_not_interested_seconds),
    outcome_floor_seconds = coalesce((p_settings->>'outcome_floor_seconds')::int, outcome_floor_seconds),
    rapid_click_seconds = coalesce((p_settings->>'rapid_click_seconds')::int, rapid_click_seconds),
    burst_window_minutes = coalesce((p_settings->>'burst_window_minutes')::int, burst_window_minutes),
    burst_min_clicks = coalesce((p_settings->>'burst_min_clicks')::int, burst_min_clicks),
    burst_data_min_clicks = coalesce((p_settings->>'burst_data_min_clicks')::int, burst_data_min_clicks),
    burst_result_share_pct = coalesce((p_settings->>'burst_result_share_pct')::int, burst_result_share_pct),
    repeat_clicks_per_day = coalesce((p_settings->>'repeat_clicks_per_day')::int, repeat_clicks_per_day),
    no_dial_share_pct = coalesce((p_settings->>'no_dial_share_pct')::int, no_dial_share_pct),
    declared_other_share_pct = coalesce((p_settings->>'declared_other_share_pct')::int, declared_other_share_pct),
    score_min_clicks = coalesce((p_settings->>'score_min_clicks')::int, score_min_clicks),
    call_quality_visible_to_employees = coalesce((p_settings->>'visible_to_employees')::boolean, call_quality_visible_to_employees),
    call_quality_enforced = coalesce((p_settings->>'enforced')::boolean, call_quality_enforced),
    call_quality_share_line = coalesce((p_settings->>'share_line')::boolean, call_quality_share_line),
    updated_at = now()
  where id = 1;
end;
$$;
revoke all on function public.update_call_quality_settings(jsonb) from public, anon;
grant execute on function public.update_call_quality_settings(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------- 10) reminders (in-app notifications)
-- Every 5 min in the working day: a CALL tap older than reminder_after_minutes (30) with nothing saved on that
-- lead since (no status, note, follow-up move, WhatsApp tap or later tap), lead still with that employee.
-- One reminder per tap; more than 3 at once for one employee become a single reminder.
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
    and c.clicked_at < now() - make_interval(mins => v_set.reminder_after_minutes)
    and c.clicked_at > now() - interval '3 hours'
    and not exists (select 1 from lead_activity_log a where a.employee_id = c.employee_id and a.lead_id = c.lead_id and a.created_at >= c.clicked_at)
    and not exists (select 1 from lead_notes n where n.employee_id = c.employee_id and n.lead_id = c.lead_id and n.created_at >= c.clicked_at)
    and not exists (select 1 from contact_click_log k where k.employee_id = c.employee_id and k.lead_id = c.lead_id
                      and k.clicked_at > c.clicked_at);

  for v_emp in select employee_id, count(*) n from _cq_nudge group by 1 loop
    if v_emp.n > 3 then
      insert into notification (employee_id, employee_name, title, message, type, is_read)
      select v_emp.employee_id, e.name, 'No result saved',
             format('You dialed %s leads more than %s minutes ago and no result is saved yet. Open each lead and save what happened.',
                    v_emp.n, v_set.reminder_after_minutes),
             'CALL_OUTCOME_MISSING', false
      from employees e where e.id = v_emp.employee_id;
      v_sent := v_sent + 1;
    else
      for v_click in select * from _cq_nudge where employee_id = v_emp.employee_id loop
        insert into notification (employee_id, employee_name, title, message, type, is_read, related_lead_id)
        select v_click.employee_id, e.name, 'No result saved',
               format('You dialed %s %s minutes ago and no result is saved yet. Open the lead and save what happened.',
                      coalesce(v_click.lead_name, 'a lead'), v_click.minutes),
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
  v_week jsonb;
  v_score text;
  v_sent integer := 0;
begin
  select * into v_set from lead_engine_settings where id = 1;
  if not v_set.call_quality_visible_to_employees or v_set.call_quality_live_since is null then
    return 0;
  end if;
  for v_row in
    select d.employee_id, e.name, sum(d.dial_clicks)::int dials, sum(d.results_saved)::int saved,
           sum(d.dial_clicks - d.results_saved - d.redials)::int no_result_yet
    from call_quality_daily(null, v_today, v_today) d
    join employees e on e.id = d.employee_id and e.is_active
    group by 1, 2
    having sum(d.dial_clicks) > 0
  loop
    v_week := call_quality_week(v_row.employee_id, v_today);
    v_score := coalesce((v_week->(v_week->>'main')->>'genuine_score') || ' (' || (v_week->(v_week->>'main')->>'band') || ')', 'not enough data yet');
    insert into notification (employee_id, employee_name, title, message, type, is_read)
    values (v_row.employee_id, v_row.name, 'Today''s calls',
            format('Today: %s dials, %s results saved, %s dials with no result yet. Your score (last 7 days): %s.',
                   v_row.dials, v_row.saved, v_row.no_result_yet, v_score),
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
