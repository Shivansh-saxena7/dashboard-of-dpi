-- 2026-11-23 Admin Performance Report v3 (simple view). DRAFT, NOT APPLIED. Apply only on the owner's "haan", from an
-- LF copy (git cat-file -p <commit>:<this file>), after a rolled-back dry run, at least 2 minutes away from a recycle
-- sweep (:00/:15/:30/:45 IST) and the hourly refresh (:37 IST). Rollback: 2026-11-23_perf_report_v3_rollback.sql.
-- Additive only: 6 new functions; v1 / v2 and the snapshot table are not changed.
--
-- What v3 adds for the simple page:
--   * filters take several values everywhere: employee_ids, sources, team_ids, projects, origins (Given as) and
--     lead_types (Type: LEAD / DATA); the v1 single "lead_type" still works.
--   * connected: the client was reached during the assignment: a result Connected, Converted or Not interested was
--     saved, or the lead moved to Follow-up, or had a visit. Based on saved results (not an estimate).
--   * split rows: employee x Given as (the assignment's origin) and employee x source.
--   * an admin reassign that kept the stage (positive lead) counts as Given by admin, not Given back.
--   * get_lead_journey: every assignment of one lead with how it came and what happened (live tables).
--   * drill-down rows carry the lead's CURRENT owner and whether it is positive (for "give to" from the report).
-- Every number is distinct leads; % = number / the row's leads (no leads -> no %). Range = assignments that started in
-- the range (IST days), at most 800 days.
begin;

create or replace function public.perf_stints_in_v3(p_from date, p_to date, p_filters jsonb)
returns setof public.perf_stints
language plpgsql stable security definer set search_path to 'public' as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb);
begin
  if not coalesce((select is_admin()), false) then raise exception 'perf report: admin only'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 800 then raise exception 'perf report: bad date range'; end if;
  -- An admin reassign that kept a positive lead's stage writes a lead_restore_log row too; the snapshot calls that
  -- "Given back". Here it is "Given by admin" (the restore row points at an ADMIN_REASSIGN activity).
  return query
  select s.* from (select s0.stint_id, s0.lead_id, s0.employee_id, s0.team_id, s0.lead_type, s0.source, s0.source_raw, s0.project, 
      case when s0.origin = 'RESTORED' and exists (select 1 from lead_restore_log r join lead_activity_log a on a.id = r.activity_id
        where r.lead_id = s0.lead_id and r.new_lead_history_id = s0.stint_id and a.activity_type = 'ADMIN_REASSIGN') then 'ADMIN_GIVEN' else s0.origin end, s0.assigned_at, s0.ended_at, s0.is_active, s0.lead_merged, s0.calls, s0.followup_move, s0.followup_reminder, s0.visit, s0.visit_verified, s0.booked, s0.converted, s0.whatsapp, s0.last_result, s0.last_stage, s0.def_version, s0.refreshed_at
    from perf_stints s0
    where s0.assigned_at >= (p_from::timestamp at time zone 'Asia/Kolkata')
      and s0.assigned_at < ((p_to + 1)::timestamp at time zone 'Asia/Kolkata')) s
  where true
    and (f -> 'employee_ids' is null or s.employee_id::text in (select jsonb_array_elements_text(f -> 'employee_ids')))
    and (f -> 'team_ids' is null or s.team_id::text in (select jsonb_array_elements_text(f -> 'team_ids')))
    and (f -> 'sources' is null or s.source in (select jsonb_array_elements_text(f -> 'sources')))
    and (f -> 'projects' is null or s.project in (select jsonb_array_elements_text(f -> 'projects')))
    and (f -> 'origins' is null or s.origin in (select jsonb_array_elements_text(f -> 'origins')))
    and (f -> 'lead_types' is null or s.lead_type in (select jsonb_array_elements_text(f -> 'lead_types')))
    and (f ->> 'lead_type' is null or s.lead_type = f ->> 'lead_type');
end;
$$;

-- One row per group. Dims: total | employee | source | emp_source | emp_origin.
create or replace function public.perf_group_v3(p_from date, p_to date, p_filters jsonb, p_dim text)
returns table (k text, m jsonb)
language sql stable security definer set search_path to 'public' as $$
  with s0 as (select * from perf_stints_in_v3(p_from, p_to, p_filters)),
  s as (
    select x.*,
      case p_dim when 'employee' then x.employee_id::text when 'source' then x.source
                 when 'emp_source' then x.employee_id::text || '|' || x.source
                 when 'emp_origin' then x.employee_id::text || '|' || case when x.origin in ('SELF', 'OTHER') then 'OTHER' else x.origin end
                 else 'all' end as gk,
      (x.followup_move or x.visit or exists (select 1 from lead_activity_log a where a.lead_id = x.lead_id and a.lead_history_id = x.stint_id
         and a.activity_type = 'STATUS_UPDATE' and a.detail in ('CONNECTED', 'CONVERTED', 'NOT_INTERESTED'))) as reached
    from s0 x
  ),
  pl as (
    select gk, lead_id,
      (array_agg(case when lead_type = 'DATA' then 'DATA' when origin in ('SELF', 'OTHER') then 'OTHER' else origin end order by assigned_at, stint_id))[1] as came,
      bool_or(origin = 'RECYCLED') as rec_any,
      (array_agg(coalesce(last_result, 'NO_RESULT') order by assigned_at desc, stint_id desc))[1] as res,
      (array_agg(last_stage order by assigned_at desc, stint_id desc))[1] as stg
    from s group by gk, lead_id
  ),
  c as (
    select gk, count(distinct lead_id) as leads, count(*) as stints, count(*) filter (where origin = 'RECYCLED') as recycled_stints,
      count(distinct lead_id) filter (where origin = 'FRESH') as fresh, count(distinct lead_id) filter (where origin = 'RECYCLED') as recycled,
      count(distinct lead_id) filter (where origin = 'RESTORED') as restored, count(distinct lead_id) filter (where origin = 'ADMIN_GIVEN') as admin_given,
      count(distinct lead_id) filter (where origin in ('SELF', 'OTHER')) as other,
      count(distinct lead_id) filter (where followup_move) as followup, count(distinct lead_id) filter (where visit) as visit,
      count(distinct lead_id) filter (where visit_verified) as visit_verified, count(distinct lead_id) filter (where booked) as booked,
      count(distinct lead_id) filter (where converted) as converted, count(distinct lead_id) filter (where reached) as connected,
      count(distinct lead_id) filter (where whatsapp and not visit) as details_est, coalesce(sum(calls), 0) as calls
    from s group by gk
  ),
  p as (
    select gk,
      count(*) filter (where came = 'FRESH') as came_fresh, count(*) filter (where came = 'RECYCLED') as came_recycled,
      count(*) filter (where came = 'DATA') as came_data, count(*) filter (where came = 'RESTORED') as came_restored,
      count(*) filter (where came = 'ADMIN_GIVEN') as came_admin_given, count(*) filter (where came = 'OTHER') as came_other,
      count(*) filter (where rec_any) as recycled_any,
      count(*) filter (where res in ('NOT_CONNECTED', 'SWITCHED_OFF')) as not_connected, count(*) filter (where res = 'NOT_INTERESTED') as not_interested,
      count(*) filter (where res = 'NO_RESULT') as no_result
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
      'connected', c.connected, 'details_est', c.details_est, 'not_connected', p.not_connected, 'not_interested', p.not_interested,
      'no_result', p.no_result) as counts,
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

create or replace function public.get_perf_report_v3(p_from date, p_to date, p_filters jsonb default '{}'::jsonb)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'def_version', 1, 'api', 3,
    'as_of', (select max(refreshed_at) from perf_stints),
    'from', p_from, 'to', p_to,
    'today', (now() at time zone 'Asia/Kolkata')::date,
    'data_since', (select min(assigned_at at time zone 'Asia/Kolkata')::date from perf_stints),
    'max_days', 800,
    'totals', coalesce((select m from perf_group_v3(p_from, p_to, p_filters, 'total')), jsonb_build_object('leads', 0, 'stints', 0)),
    'by_employee', coalesce((select jsonb_agg(jsonb_build_object('employee_id', g.k, 'name', e.name, 'active', e.is_active) || g.m order by (g.m ->> 'leads')::int desc, e.name)
                    from perf_group_v3(p_from, p_to, p_filters, 'employee') g left join employees e on e.id::text = g.k), '[]'::jsonb),
    'by_source', coalesce((select jsonb_agg(jsonb_build_object('source', g.k) || g.m order by (g.m ->> 'leads')::int desc, g.k)
                  from perf_group_v3(p_from, p_to, p_filters, 'source') g), '[]'::jsonb),
    'by_emp_source', coalesce((select jsonb_agg(jsonb_build_object('employee_id', split_part(g.k, '|', 1), 'source', substr(g.k, length(split_part(g.k, '|', 1)) + 2)) || g.m
                       order by split_part(g.k, '|', 1), (g.m ->> 'leads')::int desc, g.k)
                      from perf_group_v3(p_from, p_to, p_filters, 'emp_source') g), '[]'::jsonb),
    'by_emp_origin', coalesce((select jsonb_agg(jsonb_build_object('employee_id', split_part(g.k, '|', 1), 'origin', split_part(g.k, '|', 2)) || g.m
                       order by split_part(g.k, '|', 1), (g.m ->> 'leads')::int desc, g.k)
                      from perf_group_v3(p_from, p_to, p_filters, 'emp_origin') g), '[]'::jsonb),
    'options', (select jsonb_build_object(
        'employees', coalesce(jsonb_agg(distinct jsonb_build_object('id', o.employee_id, 'name', e.name, 'active', e.is_active)) filter (where o.employee_id is not null), '[]'::jsonb),
        'sources', coalesce(jsonb_agg(distinct o.source) filter (where o.source is not null), '[]'::jsonb),
        'projects', coalesce(jsonb_agg(distinct o.project) filter (where o.project is not null), '[]'::jsonb))
      from perf_stints_in_v3(p_from, p_to, '{}'::jsonb) o left join employees e on e.id = o.employee_id),
    'definitions', (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'rule', rule) order by key), '[]'::jsonb)
                    from perf_definitions where version = 1)
      || jsonb_build_array(
        jsonb_build_object('key', 'connected', 'label', 'Connected', 'rule', 'The client was reached during the assignment: a result Connected, Converted or Not interested was saved, or the lead moved to Follow-up, or had a visit. Based on saved results.'),
        jsonb_build_object('key', 'came_as', 'label', 'Came as', 'rule', 'Each lead once per row, by its first assignment in that row: Data, Fresh, Recycled, Given back, By admin or Other. These add up to the leads in the row.'),
        jsonb_build_object('key', 'recycled_any', 'label', 'Recycled at least once', 'rule', 'Leads that the sweep gave to someone at least once in this row.'),
        jsonb_build_object('key', 'emp_source', 'label', 'Employee x Source', 'rule', 'Each person’s leads split by source. A lead handled by two people counts for both.')))
$$;

-- Drill-down v3: one row per lead (its latest matching assignment in the range), at most 200 per page, with the
-- lead's current owner and whether it is positive now (stage Follow-up / Visit / Booking or status Connected /
-- Converted, the same rule as admin_reassign_leads). Metrics: leads, stints, followup, visit, visit_verified, booked,
-- converted, connected, details_est, not_connected, not_interested, no_result, recycled_any, came:<X>, status:<X>,
-- stage:<X>, origin:<X>.
create or replace function public.get_perf_report_leads_v3(p_from date, p_to date, p_filters jsonb, p_metric text,
  p_limit int default 200, p_offset int default 0)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with s as (
    select x.*, (x.followup_move or x.visit or exists (select 1 from lead_activity_log a where a.lead_id = x.lead_id and a.lead_history_id = x.stint_id
         and a.activity_type = 'STATUS_UPDATE' and a.detail in ('CONNECTED', 'CONVERTED', 'NOT_INTERESTED'))) as reached
    from perf_stints_in_v3(p_from, p_to, p_filters) x
  ),
  pl as (
    select lead_id,
      (array_agg(case when lead_type = 'DATA' then 'DATA' when origin in ('SELF', 'OTHER') then 'OTHER' else origin end order by assigned_at, stint_id))[1] as came,
      bool_or(origin = 'RECYCLED') as rec_any,
      (array_agg(stint_id order by assigned_at desc, stint_id desc))[1] as latest
    from s group by lead_id
  ),
  hit as (
    select pl.lead_id, (select x.stint_id from s x where x.lead_id = pl.lead_id and
      case coalesce(p_metric, 'leads')
        when 'leads' then true when 'stints' then true
        when 'followup' then x.followup_move when 'visit' then x.visit when 'visit_verified' then x.visit_verified
        when 'booked' then x.booked when 'converted' then x.converted when 'connected' then x.reached
        when 'details_est' then x.whatsapp and not x.visit
        when 'not_connected' then x.stint_id = pl.latest and x.last_result in ('NOT_CONNECTED', 'SWITCHED_OFF')
        when 'not_interested' then x.stint_id = pl.latest and x.last_result = 'NOT_INTERESTED'
        when 'no_result' then x.stint_id = pl.latest and x.last_result is null
        when 'recycled_any' then pl.rec_any and x.stint_id = pl.latest
        else (p_metric like 'came:%' and pl.came = substr(p_metric, 6) and x.stint_id = pl.latest)
          or (p_metric like 'status:%' and x.stint_id = pl.latest and coalesce(x.last_result, 'NO_RESULT') = substr(p_metric, 8))
          or (p_metric like 'stage:%' and x.stint_id = pl.latest and x.last_stage = substr(p_metric, 7))
          or (p_metric like 'origin:%' and (case when x.origin in ('SELF', 'OTHER') then 'OTHER' else x.origin end) = substr(p_metric, 8)) end
      order by x.assigned_at desc, x.stint_id desc limit 1) as stint_id
    from pl
  ),
  hits as (select * from hit where stint_id is not null)
  select jsonb_build_object('metric', p_metric, 'total', (select count(*) from hits),
    'rows', coalesce((select jsonb_agg(r order by r ->> 'assigned_at' desc, r ->> 'stint_id') from (
      select jsonb_build_object('stint_id', x.stint_id, 'lead_id', x.lead_id, 'lead_name', l.name, 'employee_id', x.employee_id, 'employee_name', e.name,
        'lead_type', x.lead_type, 'source', x.source, 'project', x.project, 'origin', x.origin, 'assigned_at', x.assigned_at,
        'last_result', x.last_result, 'last_stage', x.last_stage, 'visit', x.visit, 'booked', x.booked, 'converted', x.converted, 'connected', x.reached,
        'current_owner_id', l.current_owner_id, 'current_owner_name', o.name, 'lead_status', l.status, 'lead_stage', l.board_stage,
        'positive', coalesce(l.board_stage, 'LEADS') in ('FOLLOW_UP', 'VISIT', 'BOOKING') or l.status in ('CONNECTED', 'CONVERTED'),
        'available', l.status <> 'JUNK' and l.merged_into_lead_id is null) r
      from hits h join s x on x.stint_id = h.stint_id join leads l on l.id = h.lead_id
      left join employees e on e.id = x.employee_id left join employees o on o.id = l.current_owner_id
      order by x.assigned_at desc, x.stint_id
      limit least(greatest(coalesce(p_limit, 200), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) z), '[]'::jsonb))
$$;

-- Live facts of one assignment (not the hourly snapshot): follow-up, visit, connected, converted, last result.
create or replace function public.perf_stint_facts(p_stint_id uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with h as (
    select h.*, coalesce((select min(n.assigned_at) from lead_history n where n.lead_id = h.lead_id and n.assigned_at > h.assigned_at), 'infinity'::timestamptz) as end_at
    from lead_history h where h.id = p_stint_id
  )
  select jsonb_build_object(
    'followup', exists (select 1 from lead_activity_log a, h where a.lead_id = h.lead_id and a.lead_history_id = h.id and a.activity_type = 'BOARD_STAGE_MOVE' and a.detail = 'FOLLOW_UP'),
    'visit', exists (select 1 from site_visits v, h where v.lead_id = h.lead_id and v.employee_id = h.employee_id and v.event_type in ('VISIT', 'REVISIT') and v.denied_at is null and v.created_at >= h.assigned_at and v.created_at < h.end_at),
    'converted', exists (select 1 from lead_activity_log a, h where a.lead_id = h.lead_id and a.lead_history_id = h.id and a.activity_type = 'STATUS_UPDATE' and a.detail = 'CONVERTED'),
    'connected', exists (select 1 from lead_activity_log a, h where a.lead_id = h.lead_id and a.lead_history_id = h.id and (a.detail in ('CONNECTED', 'CONVERTED', 'NOT_INTERESTED') and a.activity_type = 'STATUS_UPDATE' or a.activity_type = 'BOARD_STAGE_MOVE' and a.detail = 'FOLLOW_UP'))
                 or exists (select 1 from site_visits v, h where v.lead_id = h.lead_id and v.employee_id = h.employee_id and v.event_type in ('VISIT', 'REVISIT') and v.denied_at is null and v.created_at >= h.assigned_at and v.created_at < h.end_at),
    'result', (select a.detail from lead_activity_log a, h where a.lead_id = h.lead_id and a.lead_history_id = h.id and a.activity_type = 'STATUS_UPDATE' order by a.created_at desc, a.id desc limit 1))
$$;

-- A lead's journey (admin only): every assignment, who had it, how it came and what happened (live tables).
create or replace function public.get_lead_journey(p_lead_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not coalesce((select is_admin()), false) then raise exception 'perf report: admin only'; end if;
  return jsonb_build_object('lead_id', p_lead_id,
    'stints', coalesce((select jsonb_agg(jsonb_build_object('stint_id', h.id, 'employee_id', h.employee_id, 'employee_name', e.name, 'assigned_at', h.assigned_at,
        'ended_at', (select min(n.assigned_at) from lead_history n where n.lead_id = h.lead_id and n.assigned_at > h.assigned_at), 'active', h.is_active,
        'origin', case when h.assigned_by_type = 'SELF' then 'SELF'
                       when h.assigned_at = (select min(f.assigned_at) from lead_history f where f.lead_id = h.lead_id) then 'FRESH'
                       when h.recycle_reason is not null then 'RECYCLED'
                       when exists (select 1 from lead_restore_log rl left join lead_activity_log ra on ra.id = rl.activity_id where rl.lead_id = h.lead_id and rl.new_lead_history_id = h.id
                         and ra.activity_type is distinct from 'ADMIN_REASSIGN') then 'RESTORED'
                       when h.assigned_by_type = 'ADMIN' then 'ADMIN_GIVEN' else 'OTHER' end) || perf_stint_facts(h.id) order by h.assigned_at, h.id)
      from lead_history h left join employees e on e.id = h.employee_id where h.lead_id = p_lead_id), '[]'::jsonb));
end;
$$;

revoke all on function public.perf_stints_in_v3(date, date, jsonb), public.perf_group_v3(date, date, jsonb, text),
  public.get_perf_report_v3(date, date, jsonb), public.get_perf_report_leads_v3(date, date, jsonb, text, int, int),
  public.get_lead_journey(uuid) from public, anon;
-- Internal helper (no admin check of its own): only the admin-checked functions above / in the give-leads file call it.
revoke all on function public.perf_stint_facts(uuid) from public, anon, authenticated;
grant execute on function public.perf_stints_in_v3(date, date, jsonb), public.perf_group_v3(date, date, jsonb, text),
  public.get_perf_report_v3(date, date, jsonb), public.get_perf_report_leads_v3(date, date, jsonb, text, int, int),
  public.get_lead_journey(uuid) to authenticated, service_role;

commit;
