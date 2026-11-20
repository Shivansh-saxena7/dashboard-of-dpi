-- 2026-11-20 Admin Performance Report: one row per assignment ("stint") + admin-only read RPCs. DRAFT, NOT APPLIED.
-- Apply only after the owner's "haan", from an LF copy (git show <commit>:<this file>), after a rolled-back dry run,
-- at least 2 minutes away from a recycle sweep (:00/:15/:30/:45). Rollback: 2026-11-20_perf_report_rollback.sql.
-- Additive only: 3 new tables, 5 new functions; nothing existing is changed. The hourly refresh job is a separate
-- file (2026-11-20_perf_report_cron.sql), so the tables and RPCs can be checked before anything runs on a timer.
--
-- Why a snapshot: the sweep keeps moving leads, so a lead's status today says nothing about what one employee did with
-- it. Each lead_history row is one employee's stint; the stint ends when the next stint of the same lead starts. What
-- happened inside that window (by that employee, on that stint) is credited to that stint. Stints that ended more than
-- 3 days ago are frozen (not recomputed) unless the definitions version changes, so old months stay stable.
--
-- Definitions v1 (also stored in perf_definitions, read by the page's "i" popups):
--   origin       FRESH (first stint of the lead) | RECYCLED (recycle_reason set) | RESTORED (lead_restore_log
--                .new_lead_history_id) | ADMIN_GIVEN (assigned by an admin, not first) | SELF (personal lead) | OTHER
--   followup     a move to the Follow-up stage on this stint, or a reminder set on this stint
--   visit        a VISIT / REVISIT logged by this employee inside the stint window, not denied
--   booked       a BOOKED event by this employee inside the stint window, not denied
--   converted    a result "Converted" saved on this stint
--   details_est  WhatsApp tapped on this stint and no visit (an estimate: the app has no "details shared" result)
--   result       the last result saved on this stint (NOT_CONNECTED, SWITCHED_OFF, NOT_INTERESTED, CONNECTED,
--                CONVERTED); no_result = nothing saved on this stint
--   range        a stint is in a date range when it STARTED in it (IST days); a lead given twice counts twice as stints
--                and once in "leads"
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
  (1, 'stint', 'Assignment', 'One employee''s turn with a lead: from when it was given to them until it was given to someone else.'),
  (1, 'range', 'Date range', 'An assignment is counted in the range when it started in it (IST days). A lead given to the same person twice counts twice in Assignments and once in Leads.'),
  (1, 'fresh', 'Fresh', 'The first assignment of the lead.'),
  (1, 'recycled', 'Recycled', 'Given by the sweep after the previous person''s time ran out.'),
  (1, 'restored', 'Given back', 'Given back by an admin from Positive-history Junk.'),
  (1, 'admin_given', 'Given by admin', 'Given by an admin (reassign, transfer), not the first assignment.'),
  (1, 'followup', 'Follow-up', 'Moved to Follow-up, or a reminder set, during this assignment.'),
  (1, 'visit', 'Visit', 'A visit or revisit logged by this person during this assignment, not denied.'),
  (1, 'booked', 'Booking', 'A booking logged by this person during this assignment, not denied.'),
  (1, 'converted', 'Converted', 'The result "Converted" saved during this assignment.'),
  (1, 'details_est', 'Details sent, no visit (estimate)', 'WhatsApp opened during this assignment and no visit. An estimate: the app has no "details shared" result yet.'),
  (1, 'not_connected', 'Not connected', 'The last result saved during this assignment was Not connected or Switched off.'),
  (1, 'not_interested', 'Not interested', 'The last result saved during this assignment was Not interested.'),
  (1, 'no_result', 'No result', 'No result saved during this assignment.')
on conflict (version, key) do nothing;

create table if not exists public.perf_stints (
  stint_id uuid primary key,          -- lead_history.id
  lead_id uuid not null,
  employee_id uuid not null,
  team_id uuid,                       -- the employee's team when the row was built (no team history exists)
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

-- Build / update stint rows. Cheap to run hourly: frozen rows (ended > 3 days ago, same version) are skipped.
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
  )
  insert into perf_stints as p (stint_id, lead_id, employee_id, team_id, lead_type, source, source_raw, project, origin,
    assigned_at, ended_at, is_active, lead_merged, calls, followup_move, followup_reminder, visit, visit_verified, booked,
    converted, whatsapp, last_result, def_version, refreshed_at)
  select t.id, t.lead_id, t.employee_id, e.team_id, l.lead_type, perf_source(l.source), l.source, l.project,
    case when t.assigned_by_type = 'SELF' then 'SELF'
         when t.n = 1 then 'FRESH'
         when t.recycle_reason is not null then 'RECYCLED'
         when exists (select 1 from lead_restore_log r where r.lead_id = t.lead_id and r.new_lead_history_id = t.id) then 'RESTORED'
         when t.assigned_by_type = 'ADMIN' then 'ADMIN_GIVEN'
         else 'OTHER' end,
    t.assigned_at, t.next_at, coalesce(t.is_active, false), l.merged_into_lead_id is not null, coalesce(t.call_count, 0),
    exists (select 1 from lead_activity_log a where a.lead_id = t.lead_id and a.lead_history_id = t.id and a.activity_type = 'BOARD_STAGE_MOVE' and a.detail = 'FOLLOW_UP'),
    exists (select 1 from lead_notes n where n.lead_history_id = t.id and n.reminder_at is not null),
    exists (select 1 from site_visits v where v.lead_id = t.lead_id and v.employee_id = t.employee_id and v.event_type in ('VISIT', 'REVISIT')
            and v.denied_at is null and v.created_at >= t.assigned_at and v.created_at < coalesce(t.next_at, 'infinity')),
    exists (select 1 from site_visits v where v.lead_id = t.lead_id and v.employee_id = t.employee_id and v.event_type in ('VISIT', 'REVISIT')
            and v.verified_at is not null and v.denied_at is null and v.created_at >= t.assigned_at and v.created_at < coalesce(t.next_at, 'infinity')),
    exists (select 1 from site_visits v where v.lead_id = t.lead_id and v.employee_id = t.employee_id and v.event_type = 'BOOKED'
            and v.denied_at is null and v.created_at >= t.assigned_at and v.created_at < coalesce(t.next_at, 'infinity')),
    exists (select 1 from lead_activity_log a where a.lead_id = t.lead_id and a.lead_history_id = t.id and a.activity_type = 'STATUS_UPDATE' and a.detail = 'CONVERTED'),
    exists (select 1 from contact_click_log c where c.lead_id = t.lead_id and c.lead_history_id = t.id and c.click_type = 'WHATSAPP'),
    (select a.detail from lead_activity_log a where a.lead_id = t.lead_id and a.lead_history_id = t.id and a.activity_type = 'STATUS_UPDATE' order by a.created_at desc, a.id desc limit 1),
    v_ver, now()
  from todo t
  join leads l on l.id = t.lead_id
  left join employees e on e.id = t.employee_id
  on conflict (stint_id) do update set
    team_id = coalesce(p.team_id, excluded.team_id), lead_type = excluded.lead_type, source = excluded.source,
    source_raw = excluded.source_raw, project = excluded.project, origin = excluded.origin, ended_at = excluded.ended_at,
    is_active = excluded.is_active, lead_merged = excluded.lead_merged, calls = excluded.calls,
    followup_move = excluded.followup_move, followup_reminder = excluded.followup_reminder, visit = excluded.visit,
    visit_verified = excluded.visit_verified, booked = excluded.booked, converted = excluded.converted,
    whatsapp = excluded.whatsapp, last_result = excluded.last_result, def_version = excluded.def_version,
    refreshed_at = excluded.refreshed_at;
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

-- The report: totals, per employee, per source, per employee x LEAD/DATA. One aggregation (grouping sets), so every
-- table on the page uses the same definitions.
create or replace function public.get_perf_report(p_from date, p_to date, p_filters jsonb default '{}'::jsonb)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with s as (select * from perf_stints_in(p_from, p_to, coalesce(p_filters, '{}'::jsonb))),
  g as (
    select grouping(employee_id) ge, grouping(source) gs, grouping(lead_type) gt, employee_id, source, lead_type,
      jsonb_build_object(
        'stints', count(*), 'leads', count(distinct lead_id),
        'fresh', count(*) filter (where origin = 'FRESH'), 'recycled', count(*) filter (where origin = 'RECYCLED'),
        'restored', count(*) filter (where origin = 'RESTORED'), 'admin_given', count(*) filter (where origin = 'ADMIN_GIVEN'),
        'self', count(*) filter (where origin = 'SELF'), 'other', count(*) filter (where origin = 'OTHER'),
        'followup', count(*) filter (where followup_move or followup_reminder), 'followup_move', count(*) filter (where followup_move),
        'visit', count(*) filter (where visit), 'visit_verified', count(*) filter (where visit_verified),
        'booked', count(*) filter (where booked), 'converted', count(*) filter (where converted),
        'details_est', count(*) filter (where whatsapp and not visit),
        'not_connected', count(*) filter (where last_result in ('NOT_CONNECTED', 'SWITCHED_OFF')),
        'not_interested', count(*) filter (where last_result = 'NOT_INTERESTED'),
        'connected', count(*) filter (where last_result = 'CONNECTED'),
        'no_result', count(*) filter (where last_result is null),
        'calls', coalesce(sum(calls), 0)) m
    from s
    group by grouping sets ((), (employee_id), (source), (employee_id, lead_type))
  )
  select jsonb_build_object(
    'def_version', 1,
    'as_of', (select max(refreshed_at) from perf_stints),
    'from', p_from, 'to', p_to,
    'totals', coalesce((select m from g where ge = 1 and gs = 1 and gt = 1), '{}'::jsonb),
    'by_employee', coalesce((select jsonb_agg(jsonb_build_object('employee_id', g.employee_id, 'name', e.name) || g.m order by (g.m ->> 'stints')::int desc)
                    from g left join employees e on e.id = g.employee_id where ge = 0 and gs = 1 and gt = 1), '[]'::jsonb),
    'by_source', coalesce((select jsonb_agg(jsonb_build_object('source', g.source) || g.m order by (g.m ->> 'stints')::int desc)
                  from g where ge = 1 and gs = 0 and gt = 1), '[]'::jsonb),
    'by_employee_type', coalesce((select jsonb_agg(jsonb_build_object('employee_id', g.employee_id, 'lead_type', g.lead_type) || g.m)
                         from g where ge = 0 and gs = 1 and gt = 0), '[]'::jsonb))
$$;

-- Drill-down: the assignments behind one number (at most 200 per page). Same filters and definitions.
create or replace function public.get_perf_report_leads(p_from date, p_to date, p_filters jsonb, p_metric text,
  p_limit int default 50, p_offset int default 0)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('metric', p_metric, 'rows', coalesce(jsonb_agg(r order by r ->> 'assigned_at' desc), '[]'::jsonb))
  from (
    select jsonb_build_object('stint_id', s.stint_id, 'lead_id', s.lead_id, 'lead_name', l.name, 'employee_name', e.name,
      'lead_type', s.lead_type, 'source', s.source, 'project', s.project, 'origin', s.origin, 'assigned_at', s.assigned_at,
      'ended_at', s.ended_at, 'last_result', s.last_result, 'followup', s.followup_move or s.followup_reminder,
      'visit', s.visit, 'booked', s.booked, 'converted', s.converted) r
    from perf_stints_in(p_from, p_to, coalesce(p_filters, '{}'::jsonb)) s
    join leads l on l.id = s.lead_id
    left join employees e on e.id = s.employee_id
    where case coalesce(p_metric, 'stints')
      when 'stints' then true when 'leads' then true
      when 'fresh' then s.origin = 'FRESH' when 'recycled' then s.origin = 'RECYCLED' when 'restored' then s.origin = 'RESTORED'
      when 'admin_given' then s.origin = 'ADMIN_GIVEN' when 'self' then s.origin = 'SELF' when 'other' then s.origin = 'OTHER'
      when 'followup' then s.followup_move or s.followup_reminder when 'followup_move' then s.followup_move
      when 'visit' then s.visit when 'visit_verified' then s.visit_verified when 'booked' then s.booked
      when 'converted' then s.converted when 'details_est' then s.whatsapp and not s.visit
      when 'not_connected' then s.last_result in ('NOT_CONNECTED', 'SWITCHED_OFF')
      when 'not_interested' then s.last_result = 'NOT_INTERESTED' when 'connected' then s.last_result = 'CONNECTED'
      when 'no_result' then s.last_result is null
      else false end
    order by s.assigned_at desc, s.stint_id
    limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
  ) z
$$;

revoke all on function public.perf_source(text), public.perf_refresh(boolean), public.perf_stints_in(date, date, jsonb),
  public.get_perf_report(date, date, jsonb), public.get_perf_report_leads(date, date, jsonb, text, int, int) from public, anon;
grant execute on function public.get_perf_report(date, date, jsonb), public.get_perf_report_leads(date, date, jsonb, text, int, int),
  public.perf_stints_in(date, date, jsonb), public.perf_refresh(boolean) to authenticated, service_role;
grant execute on function public.perf_source(text) to service_role;

commit;
