-- 2026-11-20 Admin Performance Report: one row per assignment ("stint") + admin-only read RPCs. DRAFT, NOT APPLIED.
-- Apply only after the owner's "haan", from an LF copy (git show <commit>:<this file>), after a rolled-back dry run,
-- at least 2 minutes away from a recycle sweep (:00/:15/:30/:45). Rollback: 2026-11-20_perf_report_rollback.sql.
-- Additive only: 3 new tables, 6 new functions; nothing existing is changed. Separate files, in this order:
--   1. this file   2. select public.perf_refresh(true) once, check it   3. 2026-11-20_perf_report_cron.sql (hourly)
--   4. 2026-11-20_admin_report_mode.sql (the page's flag; default off)
--
-- Why a snapshot: the sweep keeps moving leads, so a lead's status today says nothing about what one employee did with
-- it. Each lead_history row is one employee's stint; it ends when the next stint of the same lead starts. What happened
-- inside that window (by that employee, on that stint) is credited to that stint. Stints that settled more than 3 days
-- ago are frozen (not recomputed) unless the definitions version changes, so old months stay stable.
--
-- Definitions v1 (owner-approved 2026-11-20; the same wording is in perf_definitions for the page's "i" popups):
--   range       stints that STARTED in the range (IST days)
--   counting    every number is distinct leads; % = that number / the row's leads (0 leads -> no %)
--   origin      FRESH (first stint of the lead) | RECYCLED (recycle_reason) | RESTORED (lead_restore_log
--               .new_lead_history_id) | ADMIN_GIVEN (by an admin, not first) | SELF (personal lead) | OTHER
--   followup    moved to the Follow-up stage on the stint (stage move only; reminders do not count)
--   visit       a VISIT / REVISIT by the same employee in the stint window, pending or verified, not denied
--   booked      a BOOKED event by the same employee in the stint window, not denied
--   converted   the result "Converted" saved on the stint (the headline conversion)
--   details_est WhatsApp tapped on the stint and no visit: an estimate (the app has no "details shared" result)
--   result      the last result saved on the lead's latest stint in the row (NC = Not connected or Switched off)
--   stage       the furthest stage the lead reached on the stint: Booking > Visit > the last stage move > Leads
--   mixes       status / stage mix use each lead's latest stint in the row; new values show under their own name
begin;

create table if not exists public.perf_source_map (
  raw_key text primary key,          -- lower(btrim(leads.source))
  source text not null
);
insert into public.perf_source_map (raw_key, source) values
  ('99 acre', '99acres'), ('99 acres', '99acres'), ('99acres', '99acres'), ('99acre', '99acres'),
  ('housing', 'Housing'), ('housing.com', 'Housing'),
  ('meta', 'Meta'), ('fb', 'Meta'), ('facebook', 'Meta'), ('ig', 'Meta'), ('instagram', 'Meta'),
  ('personal', 'Personal'), ('catcher', 'Catcher'), ('manual booking entry', 'Manual')
on conflict (raw_key) do nothing;

create table if not exists public.perf_definitions (
  version int not null,
  key text not null,
  label text not null,
  rule text not null,
  primary key (version, key)
);
insert into public.perf_definitions (version, key, label, rule) values
  (1, 'range', 'Date range', 'Counts leads whose assignment started in the range (India time). A lead given to the same person twice counts once.'),
  (1, 'percent', '% of leads', 'Each number divided by the leads in that row. No leads shows “–”.'),
  (1, 'leads', 'Leads received', 'Different leads given in the range.'),
  (1, 'fresh', 'Fresh', 'The lead’s first assignment.'),
  (1, 'recycled', 'Recycled', 'Given by the sweep after the previous person’s time ran out.'),
  (1, 'restored', 'Given back', 'Given back by an admin from Positive-history Junk.'),
  (1, 'admin_given', 'Given by admin', 'Given by an admin (reassign or transfer), not the first assignment.'),
  (1, 'followup', 'Follow-up', 'Moved to the Follow-up stage during the assignment. Reminders alone do not count.'),
  (1, 'visit', 'Visit', 'A visit or revisit logged by this person during the assignment, pending or verified, not denied. One lead counts once.'),
  (1, 'visit_verified', 'Verified visit', 'A visit that an admin or coordinator verified.'),
  (1, 'booked', 'Booking', 'A booking logged by this person during the assignment, not denied.'),
  (1, 'converted', 'Converted', 'The result “Converted” saved during the assignment.'),
  (1, 'details_est', 'Details sent, no visit (estimate)', 'WhatsApp opened during the assignment and no visit. An estimate until the app has a “Details shared” result.'),
  (1, 'not_connected', 'Not connected', 'The last result of the lead’s latest assignment was Not connected or Switched off.'),
  (1, 'not_interested', 'Not interested', 'The last result of the lead’s latest assignment was Not interested.'),
  (1, 'status_mix', 'Status mix', 'The last result of each lead’s latest assignment in the range. “No result” = nothing saved.'),
  (1, 'stage_mix', 'Stage mix', 'The furthest stage each lead reached in its latest assignment: Booking, Visit, the last stage move, or Leads.'),
  (1, 'team', 'Team', 'The team an employee was in when the assignment was first recorded. Older months use the team at that time of recording.')
on conflict (version, key) do nothing;

create table if not exists public.perf_stints (
  stint_id uuid primary key,          -- lead_history.id
  lead_id uuid not null,
  employee_id uuid not null,
  team_id uuid,                       -- the employee's team when the row was first built (no team history exists)
  lead_type text,
  source text not null,
  source_raw text,
  project text,
  origin text not null,
  assigned_at timestamptz not null,
  ended_at timestamptz,               -- next stint of the same lead started; null = still open or the lead stopped
  is_active boolean not null,
  lead_merged boolean not null default false,
  calls int not null default 0,
  followup_move boolean not null default false,
  followup_reminder boolean not null default false,
  visit boolean not null default false,
  visit_verified boolean not null default false,
  booked boolean not null default false,
  converted boolean not null default false,
  whatsapp boolean not null default false,
  last_result text,
  last_stage text not null default 'LEADS',
  def_version int not null,
  refreshed_at timestamptz not null default now()
);
create index if not exists perf_stints_assigned_idx on public.perf_stints (assigned_at);
create index if not exists perf_stints_emp_idx on public.perf_stints (employee_id, assigned_at);
create index if not exists perf_stints_lead_idx on public.perf_stints (lead_id);
alter table public.perf_stints enable row level security;
alter table public.perf_source_map enable row level security;
alter table public.perf_definitions enable row level security;
revoke all on public.perf_stints, public.perf_source_map, public.perf_definitions from public, anon, authenticated;

-- A raw source -> the name the report shows. A new spelling never breaks the report: it shows as "Other: <raw>".
create or replace function public.perf_source(p_raw text)
returns text
language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select m.source from perf_source_map m where m.raw_key = lower(btrim(p_raw))),
    case when p_raw is null or btrim(p_raw) = '' then 'Unknown' else 'Other: ' || btrim(p_raw) end)
$$;

-- Build / update stint rows. Cheap hourly: frozen rows (settled > 3 days, same version) are skipped.
-- p_full = true rebuilds everything (after a definitions version change).
create or replace function public.perf_refresh(p_full boolean default false)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_ver constant int := 1;
  v_n int;
begin
  if auth.uid() is not null and not coalesce((select is_admin()), false) then
    raise exception 'perf_refresh: admin only';
  end if;
  with h as (
    select h.*,
      row_number() over (partition by h.lead_id order by h.assigned_at, h.created_at, h.id) as n,
      lead(h.assigned_at) over (partition by h.lead_id order by h.assigned_at, h.created_at, h.id) as next_at
    from lead_history h
  ),
  todo as (
    select h.* from h
    left join perf_stints p on p.stint_id = h.id
    -- Frozen = same version, not active, nothing changed (no new next stint), and settled for 3 days (since it ended,
    -- or since it was last built when the lead simply stopped, e.g. junked).
    where p_full or p.stint_id is null or p.def_version <> v_ver or p.is_active
       or coalesce(h.is_active, false) <> p.is_active or h.next_at is distinct from p.ended_at
       or coalesce(p.ended_at, p.refreshed_at) > now() - interval '3 days'
  ),
  f as (
    select t.id, t.lead_id, t.employee_id, e.team_id, l.lead_type, perf_source(l.source) as source, l.source as source_raw, l.project,
      case when t.assigned_by_type = 'SELF' then 'SELF'
           when t.n = 1 then 'FRESH'
           when t.recycle_reason is not null then 'RECYCLED'
           when exists (select 1 from lead_restore_log r where r.lead_id = t.lead_id and r.new_lead_history_id = t.id) then 'RESTORED'
           when t.assigned_by_type = 'ADMIN' then 'ADMIN_GIVEN'
           else 'OTHER' end as origin,
      t.assigned_at, t.next_at, coalesce(t.is_active, false) as is_active, l.merged_into_lead_id is not null as lead_merged,
      coalesce(t.call_count, 0) as calls,
      exists (select 1 from lead_activity_log a where a.lead_id = t.lead_id and a.lead_history_id = t.id and a.activity_type = 'BOARD_STAGE_MOVE' and a.detail = 'FOLLOW_UP') as followup_move,
      exists (select 1 from lead_notes n where n.lead_history_id = t.id and n.reminder_at is not null) as followup_reminder,
      exists (select 1 from site_visits v where v.lead_id = t.lead_id and v.employee_id = t.employee_id and v.event_type in ('VISIT', 'REVISIT')
              and v.denied_at is null and v.created_at >= t.assigned_at and v.created_at < coalesce(t.next_at, 'infinity')) as visit,
      exists (select 1 from site_visits v where v.lead_id = t.lead_id and v.employee_id = t.employee_id and v.event_type in ('VISIT', 'REVISIT')
              and v.verified_at is not null and v.denied_at is null and v.created_at >= t.assigned_at and v.created_at < coalesce(t.next_at, 'infinity')) as visit_verified,
      exists (select 1 from site_visits v where v.lead_id = t.lead_id and v.employee_id = t.employee_id and v.event_type = 'BOOKED'
              and v.denied_at is null and v.created_at >= t.assigned_at and v.created_at < coalesce(t.next_at, 'infinity')) as booked,
      exists (select 1 from lead_activity_log a where a.lead_id = t.lead_id and a.lead_history_id = t.id and a.activity_type = 'STATUS_UPDATE' and a.detail = 'CONVERTED') as converted,
      exists (select 1 from contact_click_log c where c.lead_id = t.lead_id and c.lead_history_id = t.id and c.click_type = 'WHATSAPP') as whatsapp,
      (select a.detail from lead_activity_log a where a.lead_id = t.lead_id and a.lead_history_id = t.id and a.activity_type = 'STATUS_UPDATE'
        order by a.created_at desc, a.id desc limit 1) as last_result,
      (select a.detail from lead_activity_log a where a.lead_id = t.lead_id and a.lead_history_id = t.id and a.activity_type = 'BOARD_STAGE_MOVE'
        order by a.created_at desc, a.id desc limit 1) as last_move
    from todo t
    join leads l on l.id = t.lead_id
    left join employees e on e.id = t.employee_id
  )
  insert into perf_stints as p (stint_id, lead_id, employee_id, team_id, lead_type, source, source_raw, project, origin,
    assigned_at, ended_at, is_active, lead_merged, calls, followup_move, followup_reminder, visit, visit_verified, booked,
    converted, whatsapp, last_result, last_stage, def_version, refreshed_at)
  select id, lead_id, employee_id, team_id, lead_type, source, source_raw, project, origin, assigned_at, next_at, is_active,
    lead_merged, calls, followup_move, followup_reminder, visit, visit_verified, booked, converted, whatsapp, last_result,
    case when booked then 'BOOKING' when visit then 'VISIT' else coalesce(nullif(btrim(last_move), ''), 'LEADS') end,
    v_ver, now()
  from f
  on conflict (stint_id) do update set
    team_id = coalesce(p.team_id, excluded.team_id), lead_type = excluded.lead_type, source = excluded.source,
    source_raw = excluded.source_raw, project = excluded.project, origin = excluded.origin, ended_at = excluded.ended_at,
    is_active = excluded.is_active, lead_merged = excluded.lead_merged, calls = excluded.calls,
    followup_move = excluded.followup_move, followup_reminder = excluded.followup_reminder, visit = excluded.visit,
    visit_verified = excluded.visit_verified, booked = excluded.booked, converted = excluded.converted,
    whatsapp = excluded.whatsapp, last_result = excluded.last_result, last_stage = excluded.last_stage,
    def_version = excluded.def_version, refreshed_at = excluded.refreshed_at;
  get diagnostics v_n = row_count;
  return jsonb_build_object('updated', v_n, 'def_version', v_ver, 'at', now());
end;
$$;

-- Filters: {"employee_ids":[uuid], "team_ids":[uuid], "sources":[text], "projects":[text], "lead_type":"LEAD"|"DATA",
-- "origins":[text]}. Missing key = no filter. Range: IST days, at most 800 days.
create or replace function public.perf_stints_in(p_from date, p_to date, p_filters jsonb)
returns setof public.perf_stints
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not coalesce((select is_admin()), false) then raise exception 'perf report: admin only'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 800 then raise exception 'perf report: bad date range'; end if;
  return query
  select s.* from perf_stints s
  where s.assigned_at >= (p_from::timestamp at time zone 'Asia/Kolkata')
    and s.assigned_at < ((p_to + 1)::timestamp at time zone 'Asia/Kolkata')
    and (p_filters -> 'employee_ids' is null or s.employee_id::text in (select jsonb_array_elements_text(p_filters -> 'employee_ids')))
    and (p_filters -> 'team_ids' is null or s.team_id::text in (select jsonb_array_elements_text(p_filters -> 'team_ids')))
    and (p_filters -> 'sources' is null or s.source in (select jsonb_array_elements_text(p_filters -> 'sources')))
    and (p_filters -> 'projects' is null or s.project in (select jsonb_array_elements_text(p_filters -> 'projects')))
    and (p_filters -> 'origins' is null or s.origin in (select jsonb_array_elements_text(p_filters -> 'origins')))
    and (p_filters ->> 'lead_type' is null or s.lead_type = p_filters ->> 'lead_type');
end;
$$;

-- One row per group for one dimension: 'total' | 'employee' | 'source' | 'employee_type'. Counts are distinct leads;
-- pct = count / leads (null when there are no leads); status / stage mixes from each lead's latest stint in the group.
create or replace function public.perf_group(p_from date, p_to date, p_filters jsonb, p_dim text)
returns table (k text, m jsonb)
language sql stable security definer set search_path to 'public' as $$
  with s as (
    select x.*, case p_dim when 'employee' then x.employee_id::text when 'source' then x.source
                           when 'employee_type' then x.employee_id::text || '|' || coalesce(x.lead_type, '') else 'all' end as gk
    from perf_stints_in(p_from, p_to, coalesce(p_filters, '{}'::jsonb)) x
  ),
  latest as (
    select distinct on (gk, lead_id) gk, lead_id, coalesce(last_result, 'NO_RESULT') as res, last_stage as stg
    from s order by gk, lead_id, assigned_at desc, stint_id desc
  ),
  c as (
    select gk,
      count(distinct lead_id) as leads, count(*) as stints,
      count(distinct lead_id) filter (where origin = 'FRESH') as fresh,
      count(distinct lead_id) filter (where origin = 'RECYCLED') as recycled,
      count(distinct lead_id) filter (where origin = 'RESTORED') as restored,
      count(distinct lead_id) filter (where origin = 'ADMIN_GIVEN') as admin_given,
      count(distinct lead_id) filter (where origin in ('SELF', 'OTHER')) as other,
      count(distinct lead_id) filter (where followup_move) as followup,
      count(distinct lead_id) filter (where visit) as visit,
      count(distinct lead_id) filter (where visit_verified) as visit_verified,
      count(distinct lead_id) filter (where booked) as booked,
      count(distinct lead_id) filter (where converted) as converted,
      count(distinct lead_id) filter (where whatsapp and not visit) as details_est,
      coalesce(sum(calls), 0) as calls
    from s group by gk
  ),
  r as (
    select gk, count(*) filter (where res in ('NOT_CONNECTED', 'SWITCHED_OFF')) as not_connected,
      count(*) filter (where res = 'NOT_INTERESTED') as not_interested, count(*) filter (where res = 'NO_RESULT') as no_result
    from latest group by gk
  ),
  sm as (select gk, jsonb_object_agg(res, n) as mix from (select gk, res, count(*) as n from latest group by 1, 2) z group by gk),
  gm as (select gk, jsonb_object_agg(stg, n) as mix from (select gk, stg, count(*) as n from latest group by 1, 2) z group by gk)
  select c.gk,
    jsonb_build_object('leads', c.leads, 'stints', c.stints, 'fresh', c.fresh, 'recycled', c.recycled, 'restored', c.restored,
      'admin_given', c.admin_given, 'other', c.other, 'followup', c.followup, 'visit', c.visit, 'visit_verified', c.visit_verified,
      'booked', c.booked, 'converted', c.converted, 'details_est', c.details_est, 'not_connected', r.not_connected,
      'not_interested', r.not_interested, 'no_result', r.no_result, 'calls', c.calls,
      'status_mix', sm.mix, 'stage_mix', gm.mix,
      'pct', (select jsonb_object_agg(key, case when c.leads = 0 then null else round(100.0 * value::numeric / c.leads, 1) end)
              from jsonb_each_text(jsonb_build_object('fresh', c.fresh, 'recycled', c.recycled, 'restored', c.restored,
                'admin_given', c.admin_given, 'other', c.other, 'followup', c.followup, 'visit', c.visit, 'visit_verified', c.visit_verified,
                'booked', c.booked, 'converted', c.converted, 'details_est', c.details_est, 'not_connected', r.not_connected,
                'not_interested', r.not_interested, 'no_result', r.no_result))),
      'status_pct', (select jsonb_object_agg(key, round(100.0 * value::numeric / nullif(c.leads, 0), 1)) from jsonb_each_text(sm.mix)),
      'stage_pct', (select jsonb_object_agg(key, round(100.0 * value::numeric / nullif(c.leads, 0), 1)) from jsonb_each_text(gm.mix)))
  from c join r using (gk) join sm using (gk) join gm using (gk)
$$;

-- The report: totals, per employee, per source, per employee x LEAD/DATA, the filter options for the range, the
-- definitions, and "as of". One call per filter change.
create or replace function public.get_perf_report(p_from date, p_to date, p_filters jsonb default '{}'::jsonb)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'def_version', 1,
    'as_of', (select max(refreshed_at) from perf_stints),
    'from', p_from, 'to', p_to,
    'totals', coalesce((select m from perf_group(p_from, p_to, p_filters, 'total')), jsonb_build_object('leads', 0, 'stints', 0)),
    'by_employee', coalesce((select jsonb_agg(jsonb_build_object('employee_id', g.k, 'name', e.name) || g.m order by (g.m ->> 'leads')::int desc, e.name)
                    from perf_group(p_from, p_to, p_filters, 'employee') g left join employees e on e.id::text = g.k), '[]'::jsonb),
    'by_source', coalesce((select jsonb_agg(jsonb_build_object('source', g.k) || g.m order by (g.m ->> 'leads')::int desc, g.k)
                  from perf_group(p_from, p_to, p_filters, 'source') g), '[]'::jsonb),
    'by_employee_type', coalesce((select jsonb_agg(jsonb_build_object('employee_id', split_part(g.k, '|', 1), 'lead_type', nullif(split_part(g.k, '|', 2), '')) || g.m)
                         from perf_group(p_from, p_to, p_filters, 'employee_type') g), '[]'::jsonb),
    'options', (select jsonb_build_object(
        'employees', coalesce(jsonb_agg(distinct jsonb_build_object('id', o.employee_id, 'name', e.name)) filter (where o.employee_id is not null), '[]'::jsonb),
        'teams', coalesce(jsonb_agg(distinct jsonb_build_object('id', o.team_id, 'name', t.name)) filter (where o.team_id is not null), '[]'::jsonb),
        'sources', coalesce(jsonb_agg(distinct o.source) filter (where o.source is not null), '[]'::jsonb),
        'projects', coalesce(jsonb_agg(distinct o.project) filter (where o.project is not null), '[]'::jsonb))
      from perf_stints_in(p_from, p_to, '{}'::jsonb) o left join employees e on e.id = o.employee_id left join teams t on t.id = o.team_id),
    'definitions', (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'rule', rule) order by key), '[]'::jsonb)
                    from perf_definitions where version = 1))
$$;

-- Drill-down: the leads behind one number (at most 200 per page). Same filters and definitions. One row per lead
-- (its latest matching stint in the range).
create or replace function public.get_perf_report_leads(p_from date, p_to date, p_filters jsonb, p_metric text,
  p_limit int default 200, p_offset int default 0)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with s as (select * from perf_stints_in(p_from, p_to, coalesce(p_filters, '{}'::jsonb))),
  latest as (select distinct on (lead_id) lead_id, stint_id from s order by lead_id, assigned_at desc, stint_id desc),
  hit as (
    select distinct on (s.lead_id) s.* from s
    left join latest lt on lt.stint_id = s.stint_id
    where case coalesce(p_metric, 'leads')
      when 'leads' then true when 'stints' then true
      when 'fresh' then s.origin = 'FRESH' when 'recycled' then s.origin = 'RECYCLED' when 'restored' then s.origin = 'RESTORED'
      when 'admin_given' then s.origin = 'ADMIN_GIVEN' when 'other' then s.origin in ('SELF', 'OTHER')
      when 'followup' then s.followup_move when 'visit' then s.visit when 'visit_verified' then s.visit_verified
      when 'booked' then s.booked when 'converted' then s.converted when 'details_est' then s.whatsapp and not s.visit
      when 'not_connected' then lt.stint_id is not null and s.last_result in ('NOT_CONNECTED', 'SWITCHED_OFF')
      when 'not_interested' then lt.stint_id is not null and s.last_result = 'NOT_INTERESTED'
      when 'no_result' then lt.stint_id is not null and s.last_result is null
      else (p_metric like 'status:%' and lt.stint_id is not null and coalesce(s.last_result, 'NO_RESULT') = substr(p_metric, 8))
        or (p_metric like 'stage:%' and lt.stint_id is not null and s.last_stage = substr(p_metric, 7)) end
    order by s.lead_id, s.assigned_at desc, s.stint_id desc
  )
  select jsonb_build_object('metric', p_metric,
    'total', (select count(*) from hit),
    'rows', coalesce((select jsonb_agg(r order by r ->> 'assigned_at' desc, r ->> 'stint_id') from (
      select jsonb_build_object('stint_id', h.stint_id, 'lead_id', h.lead_id, 'lead_name', l.name, 'employee_name', e.name,
        'lead_type', h.lead_type, 'source', h.source, 'project', h.project, 'origin', h.origin, 'assigned_at', h.assigned_at,
        'last_result', h.last_result, 'last_stage', h.last_stage, 'visit', h.visit, 'booked', h.booked, 'converted', h.converted) r
      from hit h join leads l on l.id = h.lead_id left join employees e on e.id = h.employee_id
      order by h.assigned_at desc, h.stint_id
      limit least(greatest(coalesce(p_limit, 200), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) z), '[]'::jsonb))
$$;

revoke all on function public.perf_source(text), public.perf_refresh(boolean), public.perf_stints_in(date, date, jsonb),
  public.perf_group(date, date, jsonb, text), public.get_perf_report(date, date, jsonb),
  public.get_perf_report_leads(date, date, jsonb, text, int, int) from public, anon;
grant execute on function public.get_perf_report(date, date, jsonb), public.get_perf_report_leads(date, date, jsonb, text, int, int),
  public.perf_stints_in(date, date, jsonb), public.perf_group(date, date, jsonb, text), public.perf_refresh(boolean) to authenticated, service_role;
grant execute on function public.perf_source(text) to service_role;

commit;
