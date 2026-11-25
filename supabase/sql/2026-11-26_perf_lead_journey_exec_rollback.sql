-- Rollback of 2026-11-26_perf_lead_journey_exec.sql: the helper back to the first applied text (language sql). Grants are kept.
begin;
create or replace function public.perf_journey_stints_v1(p_from date, p_to date, p_filters jsonb)
returns table (lead_id uuid, stint_id uuid, seq int, employee_id uuid, team_id uuid, lead_type text, source text, project text,
  origin text, assigned_at timestamptz, ended_at timestamptz, next_origin text, calls int, worked boolean, first_action_at timestamptz,
  days_held numeric, positive boolean, pos_at timestamptz, pos_kind text, last_result text, in_cohort boolean, move text,
  excused text, effort_ok boolean, missed boolean, won boolean, assist boolean)
language sql stable security definer set search_path to 'public' as $$
  with f as (select coalesce(p_filters, '{}'::jsonb) as j,
                    p_from::timestamp at time zone 'Asia/Kolkata' as t0, (p_to + 1)::timestamp at time zone 'Asia/Kolkata' as t1),
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
$$;
commit;
