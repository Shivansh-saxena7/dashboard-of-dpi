-- 2026-11-23 Admin Performance Report v2: "came as" columns, recycled-at-least-once, employee x source, drill-down for
-- them. DRAFT, NOT APPLIED. Apply only on the owner's "haan", from an LF copy (git show <commit>:<this file>), after a
-- rolled-back dry run, at least 2 minutes away from a recycle sweep (:00/:15/:30/:45 IST) and from the hourly refresh
-- (:37 IST). Rollback: 2026-11-23_perf_report_v2_rollback.sql.
-- Additive only: 3 new functions. The v1 functions and tables (2026-11-20_perf_report.sql) are not changed, so the
-- rollback is a plain drop and the v1 page keeps working.
--
-- Definitions (v1 wording, one addition):
--   came as      each lead once per row, by its FIRST assignment in that row (date range + filters + the row's own
--                employee / source): Data (a Data lead), Fresh, Recycled, Given back, By admin, Other (personal etc.).
--                The six add up to the row's leads.
--   recycled_any leads that were given by the sweep at least once in that row.
--   everything else is exactly perf_group (v1): distinct leads, % of the row's leads, NC / NI / mixes from each lead's
--   latest assignment in the row.
-- Filters as v1: {"employee_ids":[...], "sources":[...], "team_ids":[...], "projects":[...], "lead_type":..., "origins":[...]}
-- (arrays = several employees / sources; sent in the RPC body, never in a URL).
begin;

create or replace function public.perf_group_v2(p_from date, p_to date, p_filters jsonb, p_dim text)
returns table (k text, m jsonb)
language sql stable security definer set search_path to 'public' as $$
  with s as (
    select x.*, case p_dim when 'employee' then x.employee_id::text when 'source' then x.source
                           when 'employee_type' then x.employee_id::text || '|' || coalesce(x.lead_type, '')
                           when 'emp_source' then x.employee_id::text || '|' || x.source else 'all' end as gk
    from perf_stints_in(p_from, p_to, coalesce(p_filters, '{}'::jsonb)) x
  ),
  pl as (
    select gk, lead_id,
      (array_agg(case when lead_type = 'DATA' then 'DATA' when origin in ('SELF', 'OTHER') then 'OTHER' else origin end
         order by assigned_at, stint_id))[1] as came,
      bool_or(origin = 'RECYCLED') as rec_any,
      (array_agg(coalesce(last_result, 'NO_RESULT') order by assigned_at desc, stint_id desc))[1] as res,
      (array_agg(last_stage order by assigned_at desc, stint_id desc))[1] as stg
    from s group by gk, lead_id
  ),
  c as (
    select gk,
      count(distinct lead_id) as leads, count(*) as stints,
      count(*) filter (where origin = 'RECYCLED') as recycled_stints,
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
  p as (
    select gk,
      count(*) filter (where came = 'FRESH') as came_fresh, count(*) filter (where came = 'RECYCLED') as came_recycled,
      count(*) filter (where came = 'DATA') as came_data, count(*) filter (where came = 'RESTORED') as came_restored,
      count(*) filter (where came = 'ADMIN_GIVEN') as came_admin_given, count(*) filter (where came = 'OTHER') as came_other,
      count(*) filter (where rec_any) as recycled_any,
      count(*) filter (where res in ('NOT_CONNECTED', 'SWITCHED_OFF')) as not_connected,
      count(*) filter (where res = 'NOT_INTERESTED') as not_interested, count(*) filter (where res = 'NO_RESULT') as no_result
    from pl group by gk
  ),
  sm as (select gk, jsonb_object_agg(res, n) as mix from (select gk, res, count(*) as n from pl group by 1, 2) z group by gk),
  gm as (select gk, jsonb_object_agg(stg, n) as mix from (select gk, stg, count(*) as n from pl group by 1, 2) z group by gk),
  j as (
    select c.gk, c.leads, jsonb_build_object(
      'fresh', c.fresh, 'recycled', c.recycled, 'restored', c.restored, 'admin_given', c.admin_given, 'other', c.other,
      'came_fresh', p.came_fresh, 'came_recycled', p.came_recycled, 'came_data', p.came_data, 'came_restored', p.came_restored,
      'came_admin_given', p.came_admin_given, 'came_other', p.came_other, 'recycled_any', p.recycled_any,
      'followup', c.followup, 'visit', c.visit, 'visit_verified', c.visit_verified, 'booked', c.booked, 'converted', c.converted,
      'details_est', c.details_est, 'not_connected', p.not_connected, 'not_interested', p.not_interested, 'no_result', p.no_result) as counts,
      c.stints, c.recycled_stints, c.calls, sm.mix as smix, gm.mix as gmix
    from c join p using (gk) join sm using (gk) join gm using (gk)
  )
  select j.gk,
    j.counts || jsonb_build_object('leads', j.leads, 'stints', j.stints, 'recycled_stints', j.recycled_stints, 'calls', j.calls,
      'status_mix', j.smix, 'stage_mix', j.gmix,
      'pct', (select jsonb_object_agg(key, case when j.leads = 0 then null else round(100.0 * value::numeric / j.leads, 1) end) from jsonb_each_text(j.counts)),
      'status_pct', (select jsonb_object_agg(key, round(100.0 * value::numeric / nullif(j.leads, 0), 1)) from jsonb_each_text(j.smix)),
      'stage_pct', (select jsonb_object_agg(key, round(100.0 * value::numeric / nullif(j.leads, 0), 1)) from jsonb_each_text(j.gmix)))
  from j
$$;

-- The report, v2: everything v1 returns, every row with the "came as" counts, plus employee x source and the dates the
-- page needs to explain empty ranges. One call per filter change.
create or replace function public.get_perf_report_v2(p_from date, p_to date, p_filters jsonb default '{}'::jsonb)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'def_version', 1, 'api', 2,
    'as_of', (select max(refreshed_at) from perf_stints),
    'from', p_from, 'to', p_to,
    'today', (now() at time zone 'Asia/Kolkata')::date,
    'data_since', (select min(assigned_at at time zone 'Asia/Kolkata')::date from perf_stints),
    'max_days', 800,
    'totals', coalesce((select m from perf_group_v2(p_from, p_to, p_filters, 'total')), jsonb_build_object('leads', 0, 'stints', 0)),
    'by_employee', coalesce((select jsonb_agg(jsonb_build_object('employee_id', g.k, 'name', e.name, 'active', e.is_active) || g.m order by (g.m ->> 'leads')::int desc, e.name)
                    from perf_group_v2(p_from, p_to, p_filters, 'employee') g left join employees e on e.id::text = g.k), '[]'::jsonb),
    'by_source', coalesce((select jsonb_agg(jsonb_build_object('source', g.k) || g.m order by (g.m ->> 'leads')::int desc, g.k)
                  from perf_group_v2(p_from, p_to, p_filters, 'source') g), '[]'::jsonb),
    'by_employee_type', coalesce((select jsonb_agg(jsonb_build_object('employee_id', split_part(g.k, '|', 1), 'lead_type', nullif(split_part(g.k, '|', 2), '')) || g.m)
                         from perf_group_v2(p_from, p_to, p_filters, 'employee_type') g), '[]'::jsonb),
    'by_emp_source', coalesce((select jsonb_agg(jsonb_build_object('employee_id', split_part(g.k, '|', 1), 'source', substr(g.k, length(split_part(g.k, '|', 1)) + 2)) || g.m
                       order by split_part(g.k, '|', 1), (g.m ->> 'leads')::int desc, g.k)
                      from perf_group_v2(p_from, p_to, p_filters, 'emp_source') g), '[]'::jsonb),
    'options', (select jsonb_build_object(
        'employees', coalesce(jsonb_agg(distinct jsonb_build_object('id', o.employee_id, 'name', e.name, 'active', e.is_active)) filter (where o.employee_id is not null), '[]'::jsonb),
        'teams', coalesce(jsonb_agg(distinct jsonb_build_object('id', o.team_id, 'name', t.name)) filter (where o.team_id is not null), '[]'::jsonb),
        'sources', coalesce(jsonb_agg(distinct o.source) filter (where o.source is not null), '[]'::jsonb),
        'projects', coalesce(jsonb_agg(distinct o.project) filter (where o.project is not null), '[]'::jsonb))
      from perf_stints_in(p_from, p_to, '{}'::jsonb) o left join employees e on e.id = o.employee_id left join teams t on t.id = o.team_id),
    'definitions', (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'rule', rule) order by key), '[]'::jsonb)
                    from perf_definitions where version = 1)
      || jsonb_build_array(
        jsonb_build_object('key', 'came_as', 'label', 'Came as', 'rule', 'Each lead once per row, by its first assignment in that row: Data, Fresh, Recycled, Given back, By admin or Other. These add up to the leads in the row.'),
        jsonb_build_object('key', 'recycled_any', 'label', 'Recycled at least once', 'rule', 'Leads that the sweep gave to someone at least once in this row.'),
        jsonb_build_object('key', 'emp_source', 'label', 'Employee x Source', 'rule', 'Each person’s leads split by source. A lead handled by two people counts for both, so the grand total is the sum of employees, not the leads received.')))
$$;

-- Drill-down v2: "came:<FRESH|RECYCLED|DATA|RESTORED|ADMIN_GIVEN|OTHER>" and "recycled_any" (one row per lead, its
-- latest assignment in the range); every other metric is exactly v1 get_perf_report_leads. At most 200 per page.
create or replace function public.get_perf_report_leads_v2(p_from date, p_to date, p_filters jsonb, p_metric text,
  p_limit int default 200, p_offset int default 0)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select case when coalesce(p_metric, '') like 'came:%' or p_metric = 'recycled_any' then (
    with s as (select * from perf_stints_in(p_from, p_to, coalesce(p_filters, '{}'::jsonb))),
    pl as (
      select lead_id,
        (array_agg(case when lead_type = 'DATA' then 'DATA' when origin in ('SELF', 'OTHER') then 'OTHER' else origin end order by assigned_at, stint_id))[1] as came,
        bool_or(origin = 'RECYCLED') as rec_any,
        (array_agg(stint_id order by assigned_at desc, stint_id desc))[1] as latest
      from s group by lead_id
    ),
    hit as (select pl.* from pl where case when p_metric = 'recycled_any' then rec_any else came = substr(p_metric, 6) end)
    select jsonb_build_object('metric', p_metric, 'total', (select count(*) from hit),
      'rows', coalesce((select jsonb_agg(r order by r ->> 'assigned_at' desc, r ->> 'stint_id') from (
        select jsonb_build_object('stint_id', x.stint_id, 'lead_id', x.lead_id, 'lead_name', l.name, 'employee_name', e.name,
          'lead_type', x.lead_type, 'source', x.source, 'project', x.project, 'origin', x.origin, 'assigned_at', x.assigned_at,
          'last_result', x.last_result, 'last_stage', x.last_stage, 'visit', x.visit, 'booked', x.booked, 'converted', x.converted) r
        from hit h join perf_stints x on x.stint_id = h.latest join leads l on l.id = h.lead_id left join employees e on e.id = x.employee_id
        order by x.assigned_at desc, x.stint_id
        limit least(greatest(coalesce(p_limit, 200), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) z), '[]'::jsonb)))
  else get_perf_report_leads(p_from, p_to, p_filters, p_metric, p_limit, p_offset) end
$$;

revoke all on function public.perf_group_v2(date, date, jsonb, text), public.get_perf_report_v2(date, date, jsonb),
  public.get_perf_report_leads_v2(date, date, jsonb, text, int, int) from public, anon;
grant execute on function public.perf_group_v2(date, date, jsonb, text), public.get_perf_report_v2(date, date, jsonb),
  public.get_perf_report_leads_v2(date, date, jsonb, text, int, int) to authenticated, service_role;

commit;
