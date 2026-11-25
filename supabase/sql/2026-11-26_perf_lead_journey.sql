-- 2026-11-26 Performance Report "Lead Journey" (employee seriousness). DRAFT, NOT APPLIED. Apply only on the owner's
-- "haan", from an LF copy, after a rolled-back dry run, at least 2 minutes away from a recycle sweep (:00/:15/:30/:45 IST)
-- and the hourly refresh (:37 IST). Rollback: 2026-11-26_perf_lead_journey_rollback.sql.
-- Additive: 5 new functions and the definitions v3 rows. No new table; v1-v4, the snapshot, timers, sweep untouched.
-- Read only: nothing here moves a lead or writes a row outside perf_definitions.
--
-- Owner's rules (25-26 Nov), definitions v3:
--   * cohort       assignments that STARTED in the range and match the filters ("leads given", as in v4).
--   * positive     on an assignment: Follow-up move, visit / revisit / booking (not denied), the result Connected or
--                  Converted saved on it. Dated by the event (history), as in v4.
--   * missed by me my assignment had no positive, the lead moved on by the system (recycle), I held it at least 3 days
--                  or did at least 1 call / action on it, and someone else made it positive within 60 days after it left
--                  me. NOT missed: moved by an admin give, a give back (restore), while I was on leave (or the day
--                  after), or after I became inactive (after my last action in the app).
--   * won from others my assignment had a positive, and an earlier assignment of the same lead (another employee) had none.
--   * assist       two people both made it positive, the second within 60 days after it left the first: both get it.
--   * one lead     each assignment is its own row (leads given counts assignments separately); a lead counts at most
--                  once as missed / won / assist per employee.
--   * %            of leads given in the row, never over 100%.
--   * effort       calls = the call counter on the assignment (approx: the call log is not complete); first action =
--                  the first result / stage move / call or WhatsApp tap on it.
begin;

insert into public.perf_definitions (version, key, label, rule)
select 3, key, label, rule from public.perf_definitions where version = 2
on conflict (version, key) do nothing;
insert into public.perf_definitions (version, key, label, rule) values
  (3, 'journey_range', 'Leads given', 'Assignments that started in the range and match the filters. A lead given twice to the same person counts as two assignments, but once in every lead count. What happened later (moves, results) is followed up to today.'),
  (3, 'journey_positive', 'Positive', 'On that assignment: moved to Follow-up, a visit, revisit or booking (not denied), or the result Connected or Converted saved. Dated by the event, so later moves never change it.'),
  (3, 'journey_missed', 'Missed by me', 'My assignment had no positive; the system moved the lead on (recycle); I had it at least 3 days or did at least 1 call or action on it; and someone else made it positive within 60 days after it left me. Not counted: moved by an admin give or a give back, while I was on leave (or the day after), or (for an employee who is now inactive) after their last action in the app.'),
  (3, 'journey_not_counted', 'Moved, not counted', 'Moved on with no positive but not counted as missed: an admin give, a give back, leave, inactive, or less than 3 days with no call or action.'),
  (3, 'journey_won', 'Won from others', 'My assignment had a positive, and an earlier assignment of the same lead (another employee) had none.'),
  (3, 'journey_assist', 'Assist', 'Two people both made the same lead positive, the second within 60 days after it left the first. Both get an assist (the second is not counted as won from others).'),
  (3, 'journey_pct', '% of leads given', 'Each count divided by the leads given in that row (each lead once). Never over 100%.'),
  (3, 'journey_effort', 'Calls (approx)', 'The call counter, averaged per assignment. Approx: not every call is logged. First action: the first result, stage move, call or WhatsApp tap on the assignment.'),
  (3, 'journey_low_sample', 'Low sample', 'Fewer than 20 leads given in the range: shown in grey, too few to compare.'),
  (3, 'journey_fair', 'A signal, not a verdict', 'Compare with the team average, keep fresh and recycled apart, and look at leave and lead volume before drawing a conclusion.')
on conflict (version, key) do nothing;

-- Every assignment of every lead that has a cohort assignment, with its journey facts. Helper: no admin check of its own
-- (the two RPCs below check), so it is revoked from every API role.
create or replace function public.perf_journey_stints_v1(p_from date, p_to date, p_filters jsonb)
returns table (lead_id uuid, stint_id uuid, seq int, employee_id uuid, team_id uuid, lead_type text, source text, project text,
  origin text, assigned_at timestamptz, ended_at timestamptz, next_origin text, calls int, worked boolean, first_action_at timestamptz,
  days_held numeric, positive boolean, pos_at timestamptz, pos_kind text, last_result text, in_cohort boolean, move text,
  excused text, effort_ok boolean, missed boolean, won boolean, assist boolean)
language plpgsql stable security definer set search_path to 'public' as $fn$
begin
  -- EXECUTE: planned with the real dates / filters each call (a cached generic plan was many times slower)
  return query execute $q$
  with f as (select coalesce($3, '{}'::jsonb) as j,
                    $1::timestamp at time zone 'Asia/Kolkata' as t0, ($2 + 1)::timestamp at time zone 'Asia/Kolkata' as t1),
  adm as (select r.new_lead_history_id as sid from lead_restore_log r join lead_activity_log ra on ra.id = r.activity_id
          where ra.activity_type = 'ADMIN_REASSIGN' and r.new_lead_history_id is not null),
  s0 as (
    select s.*, case when s.origin = 'RESTORED' and s.stint_id in (select sid from adm) then 'ADMIN_GIVEN' else s.origin end as org
    from perf_stints s),  -- merged leads included, as in v3 / v4 (leads given matches the main report)
  cohort as (
    select c.stint_id, c.lead_id from s0 c, f
    where c.assigned_at >= f.t0 and c.assigned_at < f.t1
      and (f.j -> 'employee_ids' is null or c.employee_id::text in (select jsonb_array_elements_text(f.j -> 'employee_ids')))
      and (f.j -> 'team_ids' is null or c.team_id::text in (select jsonb_array_elements_text(f.j -> 'team_ids')))
      and (f.j -> 'sources' is null or c.source in (select jsonb_array_elements_text(f.j -> 'sources')))
      and (f.j -> 'projects' is null or c.project in (select jsonb_array_elements_text(f.j -> 'projects')))
      and (f.j -> 'origins' is null or c.org in (select jsonb_array_elements_text(f.j -> 'origins')))
      and (f.j -> 'lead_types' is null or c.lead_type in (select jsonb_array_elements_text(f.j -> 'lead_types')))),
  lds as (select distinct lead_id from cohort),
  st as (
    select s.*, row_number() over w as sq, lead(s.org) over w as nxt
    from s0 s where s.lead_id in (select lead_id from lds)
    window w as (partition by s.lead_id order by s.assigned_at, s.stint_id)),
  pev as (
    select a.lead_history_id as sid, a.created_at as at, case when a.activity_type = 'BOARD_STAGE_MOVE' then 'FOLLOWUP' else a.detail end as kind
    from lead_activity_log a
    where a.lead_id in (select lead_id from lds)
      and ((a.activity_type = 'STATUS_UPDATE' and a.detail in ('CONNECTED', 'CONVERTED')) or (a.activity_type = 'BOARD_STAGE_MOVE' and a.detail = 'FOLLOW_UP'))
    union all
    -- inside that person's assignment window only (as perf_stints.visit); the latest such assignment if ever two
    select * from (
      select distinct on (v.id) x.stint_id, v.created_at, case when v.event_type = 'BOOKED' then 'BOOKED' else 'VISIT' end
      from site_visits v join st x on x.lead_id = v.lead_id and x.employee_id = v.employee_id and x.assigned_at <= v.created_at
        and v.created_at < coalesce(x.ended_at, 'infinity'::timestamptz)
      where v.lead_id in (select lead_id from lds) and v.denied_at is null and v.event_type in ('VISIT', 'REVISIT', 'BOOKED')
      order by v.id, x.assigned_at desc) vv
    union all
    -- the visit lock / pending check set by the person's own visit; a lock copied over by an admin give is not theirs
    select h.id, case when h.pause_reason = 'VISIT_LOCK' then h.paused_until - interval '1 month' else h.paused_until - interval '3 days' end, 'VISIT'
    from lead_history h
    where h.lead_id in (select lead_id from lds) and h.pause_reason in ('VISIT_LOCK', 'VISIT_PENDING_VERIFICATION')
      and not exists (select 1 from lead_history o where o.lead_id = h.lead_id and o.id <> h.id and o.assigned_at < h.assigned_at and o.paused_until = h.paused_until)),
  pos as (
    select sid, min(at) as pos_at,
      (array_agg(kind order by case kind when 'BOOKED' then 1 when 'CONVERTED' then 2 when 'VISIT' then 3 when 'FOLLOWUP' then 4 else 5 end, at))[1] as kind
    from pev where sid is not null group by sid),
  wev as (
    select a.lead_history_id as sid, min(a.created_at) as at from lead_activity_log a
    where a.lead_id in (select lead_id from lds) and a.activity_type in ('STATUS_UPDATE', 'BOARD_STAGE_MOVE') group by 1
    union all
    select c.lead_history_id, min(c.clicked_at) from contact_click_log c where c.lead_id in (select lead_id from lds) group by 1),
  work as (select sid, min(at) as at from wev where sid is not null group by sid),
  gone as (
    select e.id, coalesce((select max(a.created_at) from lead_activity_log a where a.employee_id = e.id), '-infinity'::timestamptz) as last_at
    from employees e where e.is_active = false),
  j as (
    select st.*, p.pos_at, p.kind as pkind, w.at as work_at,
      (p.sid is not null or st.visit or st.booked or st.converted or st.followup_move) as is_pos,
      case when st.nxt is null then null when st.nxt = 'RECYCLED' then 'system' when st.nxt = 'ADMIN_GIVEN' then 'admin' when st.nxt = 'RESTORED' then 'restore' else 'other' end as mv,
      case when st.ended_at is null then null
           when exists (select 1 from employee_leave_periods lp where lp.employee_id = st.employee_id
                        and (st.ended_at at time zone 'Asia/Kolkata')::date between lp.start_date and coalesce(lp.end_date, (st.ended_at at time zone 'Asia/Kolkata')::date) + 1) then 'leave'
           when exists (select 1 from gone g where g.id = st.employee_id and st.ended_at > g.last_at) then 'inactive' end as exc,
      extract(epoch from coalesce(st.ended_at, now()) - st.assigned_at) / 86400.0 as held
    from st left join pos p on p.sid = st.stint_id left join work w on w.sid = st.stint_id),
  k as (
    -- a positive with no dated event (rare) is dated at the end of the assignment: never makes anyone "missed" sooner
    select j.*, coalesce(j.pos_at, case when j.is_pos then coalesce(j.ended_at, now()) end) as pat,
      (j.held >= 3 or j.calls >= 1 or j.work_at is not null) as eff
    from j),
  kp as (select lead_id, sq, employee_id, pat from k where is_pos),
  -- hash joins on the lead (no per-row scan): later positive by someone else within 60 days / earlier no-positive by someone else
  later60 as (select distinct s.stint_id from k s join kp o on o.lead_id = s.lead_id and o.sq > s.sq and o.employee_id <> s.employee_id
              and o.pat <= s.ended_at + interval '60 days' where s.ended_at is not null),
  -- assist, both sides: a later positive by someone else within 60 days after I left (later60), or I made it positive
  -- within 60 days after someone else who had also made it positive left (assist_after)
  assist_after as (select distinct s.stint_id from k s join k o on o.lead_id = s.lead_id and o.sq < s.sq and o.employee_id <> s.employee_id
              and o.is_pos and o.ended_at is not null and s.pat <= o.ended_at + interval '60 days' where s.is_pos),
  wonset as (select distinct p.stint_id from k p join k o on o.lead_id = p.lead_id and o.sq < p.sq and o.employee_id <> p.employee_id and not o.is_pos
             where p.is_pos)
  select k.lead_id, k.stint_id, k.sq::int as seq, k.employee_id, k.team_id, k.lead_type, k.source, k.project, k.org as origin, k.assigned_at, k.ended_at,
    k.nxt as next_origin, k.calls, k.work_at is not null or k.calls >= 1 as worked, k.work_at as first_action_at, round(k.held::numeric, 1) as days_held,
    k.is_pos as positive, k.pat as pos_at,
    case when k.is_pos then coalesce(k.pkind, case when k.booked then 'BOOKED' when k.converted then 'CONVERTED' when k.visit then 'VISIT' else 'FOLLOWUP' end) end as pos_kind,
    k.last_result, k.stint_id in (select stint_id from cohort) as in_cohort, k.mv as move, k.exc as excused, k.eff as effort_ok,
    -- missed by me / won from others / assist
    (not k.is_pos and k.mv = 'system' and k.exc is null and k.eff and k.stint_id in (select stint_id from later60)) as missed,
    (k.is_pos and k.stint_id in (select stint_id from wonset)) as won,
    (k.is_pos and (k.stint_id in (select stint_id from later60) or k.stint_id in (select stint_id from assist_after))) as assist
  from k
$q$ using p_from, p_to, p_filters;
end;
$fn$;

-- % of leads given, never over 100 (null when nothing was given).
create or replace function public.perf_journey_pct(p jsonb)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_object_agg(k, case when coalesce((p ->> 'leads')::numeric, 0) = 0 then null
    else least(100, round(100.0 * coalesce((p ->> k)::numeric, 0) / (p ->> 'leads')::numeric, 1)) end), '{}'::jsonb)
  from unnest(array['positive', 'moved_no_pos', 'missed', 'not_counted', 'won', 'assist']) k
$$;

-- One pass (the helper runs once): the journeys page for p_view / p_employee and, when p_summary, the employee summary
-- and the team row. Journeys: one row per lead with a cohort assignment, owners in order, no client name or number.
create or replace function public.perf_journey_json(p_from date, p_to date, p_filters jsonb, p_view text, p_employee uuid,
  p_limit int, p_offset int, p_summary boolean)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with x as materialized (select * from perf_journey_stints_v1(p_from, p_to, p_filters)),
  c as (select * from x where in_cohort),
  e as (
    select c.employee_id,
      count(distinct c.lead_id) as leads, count(*) as assignments,
      count(distinct c.lead_id) filter (where c.origin = 'FRESH') as fresh,
      count(distinct c.lead_id) filter (where c.origin = 'RECYCLED') as recycled,
      count(distinct c.lead_id) filter (where c.positive) as positive,
      count(distinct c.lead_id) filter (where c.ended_at is not null and not c.positive) as moved_no_pos,
      count(distinct c.lead_id) filter (where c.missed) as missed,
      count(distinct c.lead_id) filter (where c.ended_at is not null and not c.positive and not c.missed
        and (c.move is distinct from 'system' or c.excused is not null or not c.effort_ok)) as not_counted,
      count(distinct c.lead_id) filter (where c.won) as won,
      count(distinct c.lead_id) filter (where c.assist) as assist,
      round(avg(c.calls), 1) as calls_avg,
      round((percentile_cont(0.5) within group (order by extract(epoch from c.first_action_at - c.assigned_at) / 3600.0))::numeric, 1) as first_action_h,
      round(avg(c.days_held), 1) as days_held_avg
    from c group by c.employee_id),
  t as (
    select coalesce(sum(leads), 0) as leads, coalesce(sum(assignments), 0) as assignments, coalesce(sum(fresh), 0) as fresh, coalesce(sum(recycled), 0) as recycled,
      coalesce(sum(positive), 0) as positive, coalesce(sum(moved_no_pos), 0) as moved_no_pos, coalesce(sum(missed), 0) as missed,
      coalesce(sum(not_counted), 0) as not_counted, coalesce(sum(won), 0) as won, coalesce(sum(assist), 0) as assist,
      (select round(avg(calls), 1) from c) as calls_avg,
      (select round((percentile_cont(0.5) within group (order by extract(epoch from first_action_at - assigned_at) / 3600.0))::numeric, 1) from c) as first_action_h,
      (select round(avg(days_held), 1) from c) as days_held_avg,
      (select count(distinct lead_id) from c) as distinct_leads
    from e),
  pick as (
    select lead_id, min(assigned_at) as first_at from c
    where (p_employee is null or employee_id = p_employee)
      and case coalesce(p_view, 'all')
        when 'all' then true when 'missed' then missed when 'won' then won when 'assist' then assist when 'positive' then positive
        when 'moved_no_pos' then ended_at is not null and not positive
        when 'not_counted' then ended_at is not null and not positive and not missed and (move is distinct from 'system' or excused is not null or not effort_ok)
        else false end
    group by lead_id),
  page as (select * from pick order by first_at desc, lead_id
           limit least(greatest(coalesce(p_limit, 50), 1), 500) offset greatest(coalesce(p_offset, 0), 0)),
  ls as (
    select x.lead_id, count(*) as owners,
      (array_agg(x.source order by x.seq desc))[1] as source,
      (array_agg(x.employee_id order by x.seq desc) filter (where x.positive))[1] as got_by,
      jsonb_agg(jsonb_build_object('seq', x.seq, 'employee_id', x.employee_id, 'name', em.name, 'origin', x.origin,
        'assigned_at', x.assigned_at, 'ended_at', x.ended_at, 'days', x.days_held, 'calls', x.calls, 'worked', x.worked,
        'positive', x.positive, 'result', coalesce(x.pos_kind, x.last_result, 'NO_RESULT'), 'move', x.move, 'excused', x.excused,
        'in_range', x.in_cohort, 'missed', x.missed, 'won', x.won, 'assist', x.assist) order by x.seq) filter (where x.seq <= 12) as steps
    from x join page pg on pg.lead_id = x.lead_id left join employees em on em.id = x.employee_id
    group by x.lead_id)
  select jsonb_build_object(
    'journeys', jsonb_build_object('view', coalesce(p_view, 'all'), 'employee_id', p_employee, 'total', (select count(*) from pick),
      'rows', coalesce((select jsonb_agg(jsonb_build_object('lead_id', pg.lead_id, 'lead_short', left(pg.lead_id::text, 8), 'first_at', pg.first_at,
          'lead_type', l.lead_type, 'source', ls.source, 'project', l.project, 'status', l.status, 'stage', l.board_stage,
          'available', l.status <> 'JUNK' and l.merged_into_lead_id is null,
          'positive_now', coalesce(l.board_stage, 'LEADS') in ('FOLLOW_UP', 'VISIT', 'BOOKING') or l.status in ('CONNECTED', 'CONVERTED'),
          'got_by', ls.got_by, 'got_by_name', gb.name, 'owners', ls.owners, 'steps', ls.steps) order by pg.first_at desc, pg.lead_id)
        from page pg join leads l on l.id = pg.lead_id join ls on ls.lead_id = pg.lead_id left join employees gb on gb.id = ls.got_by), '[]'::jsonb)),
    'by_employee', case when p_summary then coalesce((select jsonb_agg(to_jsonb(e) || jsonb_build_object('name', em.name, 'active', em.is_active,
        'low_sample', e.leads < 20, 'pct', perf_journey_pct(to_jsonb(e))) order by e.leads desc, em.name) from e left join employees em on em.id = e.employee_id), '[]'::jsonb) end,
    'team', case when p_summary then (select to_jsonb(t) || jsonb_build_object('pct', perf_journey_pct(to_jsonb(t))) from t) end)
$$;

-- The Lead Journey tab: employee summary, team row, the first page of journeys, definitions v3 and the filter options.
create or replace function public.get_perf_journey(p_from date, p_to date, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not coalesce((select is_admin()), false) then raise exception 'perf report: admin only'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 800 then raise exception 'perf report: bad date range'; end if;
  return perf_journey_json(p_from, p_to, p_filters, 'all', null, 50, 0, true) || jsonb_build_object(
    'api', 'journey1', 'def_version', 3, 'from', p_from, 'to', p_to,
    'today', (now() at time zone 'Asia/Kolkata')::date, 'as_of', (select max(refreshed_at) from perf_stints),
    'definitions', (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'rule', rule) order by key), '[]'::jsonb)
                    from perf_definitions where version = 3 and key like 'journey!_%' escape '!'),
    'options', jsonb_build_object(
      'employees', (select coalesce(jsonb_agg(jsonb_build_object('id', em.id, 'name', em.name, 'active', em.is_active) order by em.name), '[]'::jsonb)
                    from employees em where em.id in (select distinct employee_id from perf_stints)),
      'sources', (select coalesce(jsonb_agg(distinct source), '[]'::jsonb) from perf_stints)));
end;
$$;

-- Drill-down and Excel: journeys a page at a time (at most 500).
create or replace function public.get_perf_journey_rows(p_from date, p_to date, p_filters jsonb, p_view text default 'all',
  p_employee uuid default null, p_limit int default 200, p_offset int default 0)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not coalesce((select is_admin()), false) then raise exception 'perf report: admin only'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 800 then raise exception 'perf report: bad date range'; end if;
  if coalesce(p_view, 'all') not in ('all', 'missed', 'won', 'assist', 'positive', 'moved_no_pos', 'not_counted') then raise exception 'perf report: bad view'; end if;
  return perf_journey_json(p_from, p_to, p_filters, p_view, p_employee, p_limit, p_offset, false) -> 'journeys';
end;
$$;

revoke all on function public.perf_journey_stints_v1(date, date, jsonb), public.perf_journey_pct(jsonb),
  public.perf_journey_json(date, date, jsonb, text, uuid, int, int, boolean) from public, anon, authenticated;
revoke all on function public.get_perf_journey(date, date, jsonb), public.get_perf_journey_rows(date, date, jsonb, text, uuid, int, int) from public, anon;
grant execute on function public.get_perf_journey(date, date, jsonb), public.get_perf_journey_rows(date, date, jsonb, text, uuid, int, int) to authenticated, service_role;

commit;
