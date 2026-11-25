-- 2026-11-25 Performance Report v4: EXACT history (definitions v2). DRAFT, NOT APPLIED. Apply only on the owner's "haan",
-- from an LF copy, after a rolled-back dry run, at least 2 minutes away from a recycle sweep (:00/:15/:30/:45 IST) and the
-- hourly refresh (:37 IST). Rollback: 2026-11-25_perf_report_v4_rollback.sql. Additive: 4 new functions and the
-- definitions v2 rows; v1 / v2 / v3, the snapshot, the timers, the sweep and the visit lock are not touched.
--
-- Owner's rule (25 Nov): system movements (SLA, sweep, recycle, visit lock, stage changes) never change the report.
-- Every result is counted from the EVENT itself, on the date it happened, for the person who had the lead then:
--   * leads given   assignments that started in the range (as before).
--   * visit         a visit / revisit logged in the range (site_visits, not denied), or the visit lock / pending-check
--                   set by such a visit (same event; a lock copied over by an admin reassign is NOT a visit by the new
--                   person). Credited to the assignment that held the lead when it happened. Stage moves to Visit are
--                   not logged by the app, so they add nothing.
--   * follow-up     moved to Follow-up in the range.
--   * connected / converted / not interested / not connected
--                   that result saved in the range. A lead can count in more than one (e.g. Not interested, later a
--                   follow-up): this is what happened, not the lead's status today.
--   * details (est.) WhatsApp opened in the range on an assignment that never had a visit.
-- Each number is distinct leads per row. % = number / leads given in the row (can be over 100% when older leads were
-- worked in the range). Fresh / Recycled / Data split = how the assignment that did it came.
begin;

insert into public.perf_definitions (version, key, label, rule)
select 2, key, label, rule from public.perf_definitions where version = 1
  and key not in ('range', 'percent', 'followup', 'visit', 'converted', 'not_connected', 'not_interested', 'details_est', 'booked', 'visit_verified')
on conflict (version, key) do nothing;
insert into public.perf_definitions (version, key, label, rule) values
  (2, 'range', 'Date range', 'Leads given: assignments that started in the range. Every result (visit, follow-up, connected, converted, not interested, not connected) is counted on the date it happened, for the person who had the lead then, whatever the lead''s stage or owner is today. India time.'),
  (2, 'percent', '% of leads given', 'Each number divided by the leads given in that row. It can be over 100% when older leads were worked in the range. No leads given shows “–”.'),
  (2, 'visit', 'Visit', 'A visit or revisit logged in the range, pending or verified, not denied, credited to the person who had the lead then. It stays theirs even if the lead later moves on, is recycled after the visit lock, or its stage changes. One lead counts once per person.'),
  (2, 'visit_verified', 'Verified visit', 'A visit verified in the range.'),
  (2, 'booked', 'Booking', 'A booking logged in the range, not denied.'),
  (2, 'followup', 'Follow-up', 'Moved to Follow-up in the range. Reminders alone do not count.'),
  (2, 'connected', 'Connected', 'The client was reached in the range: a result Connected, Converted or Not interested was saved, or a follow-up or a visit happened.'),
  (2, 'converted', 'Converted', 'The result Converted saved in the range.'),
  (2, 'not_interested', 'Not interested', 'The result Not interested saved in the range, even if the lead later moved on or became positive.'),
  (2, 'not_connected', 'Not connected', 'The result Not connected or Switched off saved in the range, even if the client was reached later.'),
  (2, 'details_est', 'Details sent, no visit (estimate)', 'WhatsApp opened in the range on an assignment that never had a visit. An estimate until the app has a “Details shared” result.')
on conflict (version, key) do nothing;

-- Every event in the range on an assignment that matches the filters (assignment attributes from the snapshot).
create or replace function public.perf_event_rows_v4(p_from date, p_to date, p_filters jsonb)
returns table (stint_id uuid, lead_id uuid, employee_id uuid, team_id uuid, lead_type text, source text, project text, origin text, kind text, at timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb); t0 timestamptz; t1 timestamptz;
begin
  if not coalesce((select is_admin()), false) then raise exception 'perf report: admin only'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 800 then raise exception 'perf report: bad date range'; end if;
  t0 := p_from::timestamp at time zone 'Asia/Kolkata';
  t1 := (p_to + 1)::timestamp at time zone 'Asia/Kolkata';
  return query
  with ev as (
    select a.lead_history_id as sid, a.created_at as at,
      case a.detail when 'SWITCHED_OFF' then 'NOT_CONNECTED' else a.detail end as kind
    from lead_activity_log a
    where a.activity_type = 'STATUS_UPDATE' and a.created_at >= t0 and a.created_at < t1
      and a.detail in ('CONNECTED', 'CONVERTED', 'NOT_INTERESTED', 'NOT_CONNECTED', 'SWITCHED_OFF')
    union all
    select a.lead_history_id, a.created_at, 'FOLLOWUP' from lead_activity_log a
    where a.activity_type = 'BOARD_STAGE_MOVE' and a.detail = 'FOLLOW_UP' and a.created_at >= t0 and a.created_at < t1
    union all
    select (select h.id from lead_history h where h.lead_id = v.lead_id and h.employee_id = v.employee_id and h.assigned_at <= v.created_at
            order by h.assigned_at desc limit 1), v.created_at, case when v.event_type = 'BOOKED' then 'BOOKED' else 'VISIT' end
    from site_visits v where v.denied_at is null and v.event_type in ('VISIT', 'REVISIT', 'BOOKED') and v.created_at >= t0 and v.created_at < t1
    union all
    select (select h.id from lead_history h where h.lead_id = v.lead_id and h.employee_id = v.employee_id and h.assigned_at <= v.created_at
            order by h.assigned_at desc limit 1), v.verified_at, 'VISIT_VERIFIED'
    from site_visits v where v.denied_at is null and v.event_type in ('VISIT', 'REVISIT') and v.verified_at >= t0 and v.verified_at < t1
    union all
    -- the visit lock / pending check set by the person's own visit (start = the visit time); a lock copied to a new
    -- assignment (same paused_until as an earlier assignment of the lead) is not a new visit
    select h.id, x.started, 'VISIT' from lead_history h
    cross join lateral (select case when h.pause_reason = 'VISIT_LOCK' then h.paused_until - interval '1 month' else h.paused_until - interval '3 days' end as started) x
    where h.pause_reason in ('VISIT_LOCK', 'VISIT_PENDING_VERIFICATION') and x.started >= t0 and x.started < t1 and x.started >= h.assigned_at
      and not exists (select 1 from lead_history o where o.lead_id = h.lead_id and o.id <> h.id and o.assigned_at < h.assigned_at and o.paused_until = h.paused_until)
    union all
    select c.lead_history_id, c.clicked_at, 'WHATSAPP' from contact_click_log c
    where c.click_type = 'WHATSAPP' and c.clicked_at >= t0 and c.clicked_at < t1
  )
  select s.stint_id, s.lead_id, s.employee_id, s.team_id, s.lead_type, s.source, s.project,
    case when s.origin = 'RESTORED' and exists (select 1 from lead_restore_log r join lead_activity_log ra on ra.id = r.activity_id
      where r.lead_id = s.lead_id and r.new_lead_history_id = s.stint_id and ra.activity_type = 'ADMIN_REASSIGN') then 'ADMIN_GIVEN' else s.origin end,
    ev.kind, ev.at
  from ev join perf_stints s on s.stint_id = ev.sid
  where (f -> 'employee_ids' is null or s.employee_id::text in (select jsonb_array_elements_text(f -> 'employee_ids')))
    and (f -> 'team_ids' is null or s.team_id::text in (select jsonb_array_elements_text(f -> 'team_ids')))
    and (f -> 'sources' is null or s.source in (select jsonb_array_elements_text(f -> 'sources')))
    and (f -> 'projects' is null or s.project in (select jsonb_array_elements_text(f -> 'projects')))
    and (f -> 'origins' is null or (case when s.origin = 'RESTORED' and exists (select 1 from lead_restore_log r join lead_activity_log ra on ra.id = r.activity_id
          where r.lead_id = s.lead_id and r.new_lead_history_id = s.stint_id and ra.activity_type = 'ADMIN_REASSIGN') then 'ADMIN_GIVEN' else s.origin end)
          in (select jsonb_array_elements_text(f -> 'origins')))
    and (f -> 'lead_types' is null or s.lead_type in (select jsonb_array_elements_text(f -> 'lead_types')))
    and (f ->> 'lead_type' is null or s.lead_type = f ->> 'lead_type');
end;
$$;

-- Event counts per group (same group keys as perf_group_v3).
create or replace function public.perf_event_group_v4(p_from date, p_to date, p_filters jsonb, p_dim text)
returns table (k text, m jsonb)
language sql stable security definer set search_path to 'public' as $$
  with e as (
    select x.*,
      case p_dim when 'employee' then x.employee_id::text when 'source' then x.source
                 when 'emp_source' then x.employee_id::text || '|' || x.source
                 when 'emp_origin' then x.employee_id::text || '|' || case when x.origin in ('SELF', 'OTHER') then 'OTHER' else x.origin end
                 else 'all' end as gk
    from perf_event_rows_v4(p_from, p_to, p_filters) x
  ),
  visited as (select distinct stint_id from perf_stints where visit)
  select gk, jsonb_build_object(
    'visit', count(distinct lead_id) filter (where kind = 'VISIT'),
    'visit_verified', count(distinct lead_id) filter (where kind = 'VISIT_VERIFIED'),
    'booked', count(distinct lead_id) filter (where kind = 'BOOKED'),
    'followup', count(distinct lead_id) filter (where kind = 'FOLLOWUP'),
    'converted', count(distinct lead_id) filter (where kind = 'CONVERTED'),
    'not_interested', count(distinct lead_id) filter (where kind = 'NOT_INTERESTED'),
    'not_connected', count(distinct lead_id) filter (where kind = 'NOT_CONNECTED'),
    'connected', count(distinct lead_id) filter (where kind in ('CONNECTED', 'CONVERTED', 'NOT_INTERESTED', 'FOLLOWUP', 'VISIT')),
    'details_est', count(distinct lead_id) filter (where kind = 'WHATSAPP' and stint_id not in (select stint_id from visited)),
    'leads_worked', count(distinct lead_id) filter (where kind <> 'WHATSAPP'))
  from e group by gk
$$;

-- The v3 report (leads given, came as, mixes) with every result replaced by its event count (definitions v2).
create or replace function public.get_perf_report_v4(p_from date, p_to date, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare base jsonb; keys text[] := array['visit', 'visit_verified', 'booked', 'followup', 'converted', 'not_interested', 'not_connected', 'connected', 'details_est'];
begin
  base := get_perf_report_v3(p_from, p_to, p_filters);  -- admin check and range check happen in there
  return base || jsonb_build_object(
    'api', 4, 'def_version', 2,
    'totals', perf_merge_v4(base -> 'totals', (select m from perf_event_group_v4(p_from, p_to, p_filters, 'total')), keys),
    'by_employee', perf_merge_rows_v4(base -> 'by_employee', p_from, p_to, p_filters, 'employee', 'employee_id', keys),
    'by_source', perf_merge_rows_v4(base -> 'by_source', p_from, p_to, p_filters, 'source', 'source', keys),
    'by_emp_source', perf_merge_rows_v4(base -> 'by_emp_source', p_from, p_to, p_filters, 'emp_source', 'employee_id|source', keys),
    'by_emp_origin', perf_merge_rows_v4(base -> 'by_emp_origin', p_from, p_to, p_filters, 'emp_origin', 'employee_id|origin', keys),
    'definitions', (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'rule', rule) order by key), '[]'::jsonb) from perf_definitions where version = 2)
      || coalesce((select jsonb_agg(d) from jsonb_array_elements(base -> 'definitions') d where d ->> 'key' in ('came_as', 'recycled_any', 'emp_source')), '[]'::jsonb));
end;
$$;

-- One row: event counts replace the cohort counts; % recomputed over leads given.
create or replace function public.perf_merge_v4(p_row jsonb, p_ev jsonb, p_keys text[])
returns jsonb language sql immutable as $$
  with r as (select coalesce(p_row, jsonb_build_object('leads', 0, 'stints', 0)) || (select coalesce(jsonb_object_agg(k, coalesce((p_ev ->> k)::int, 0)), '{}'::jsonb) from unnest(p_keys) k)
                    || jsonb_build_object('leads_worked', coalesce((p_ev ->> 'leads_worked')::int, 0)) as j)
  select j || jsonb_build_object('pct', coalesce(j -> 'pct', '{}'::jsonb) || (select coalesce(jsonb_object_agg(k,
    case when coalesce((j ->> 'leads')::int, 0) = 0 then null else round(100.0 * (j ->> k)::numeric / (j ->> 'leads')::int, 1) end), '{}'::jsonb) from unnest(p_keys) k))
  from r
$$;

-- A list of rows (by employee / source / ...): every group with leads given or with events, merged.
create or replace function public.perf_merge_rows_v4(p_rows jsonb, p_from date, p_to date, p_filters jsonb, p_dim text, p_key text, p_keys text[])
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with base as (
    select case p_key when 'employee_id' then r ->> 'employee_id' when 'source' then r ->> 'source'
                      when 'employee_id|source' then (r ->> 'employee_id') || '|' || (r ->> 'source')
                      else (r ->> 'employee_id') || '|' || (r ->> 'origin') end as gk, r
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r),
  ev as (select k as gk, m from perf_event_group_v4(p_from, p_to, p_filters, p_dim)),
  j as (
    select coalesce(b.gk, ev.gk) as gk,
      perf_merge_v4(coalesce(b.r, case p_key
        when 'employee_id' then jsonb_build_object('employee_id', ev.gk, 'name', (select name from employees where id::text = ev.gk), 'active', (select is_active from employees where id::text = ev.gk))
        when 'source' then jsonb_build_object('source', ev.gk)
        when 'employee_id|source' then jsonb_build_object('employee_id', split_part(ev.gk, '|', 1), 'source', substr(ev.gk, length(split_part(ev.gk, '|', 1)) + 2))
        else jsonb_build_object('employee_id', split_part(ev.gk, '|', 1), 'origin', split_part(ev.gk, '|', 2)) end
        || jsonb_build_object('leads', 0, 'stints', 0)), ev.m, p_keys) as r
    from base b full join ev on ev.gk = b.gk)
  select coalesce(jsonb_agg(r order by coalesce((r ->> 'leads')::int, 0) desc, coalesce((r ->> 'leads_worked')::int, 0) desc, gk), '[]'::jsonb) from j
$$;

-- Drill-down v4: for a result metric, the leads with that event in the range (one row per lead, its latest such
-- event), with the assignment that did it; other metrics (leads given, came as, status / stage mix) as in v3.
create or replace function public.get_perf_report_leads_v4(p_from date, p_to date, p_filters jsonb, p_metric text,
  p_limit int default 200, p_offset int default 0)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare kinds text[];
begin
  kinds := case p_metric when 'visit' then array['VISIT'] when 'visit_verified' then array['VISIT_VERIFIED'] when 'booked' then array['BOOKED']
    when 'followup' then array['FOLLOWUP'] when 'converted' then array['CONVERTED'] when 'not_interested' then array['NOT_INTERESTED']
    when 'not_connected' then array['NOT_CONNECTED'] when 'connected' then array['CONNECTED', 'CONVERTED', 'NOT_INTERESTED', 'FOLLOWUP', 'VISIT']
    when 'details_est' then array['WHATSAPP'] else null end;
  if kinds is null then return get_perf_report_leads_v3(p_from, p_to, p_filters, p_metric, p_limit, p_offset); end if;
  return (with e as (
      select x.* from perf_event_rows_v4(p_from, p_to, p_filters) x
      where x.kind = any (kinds) and (p_metric <> 'details_est' or x.stint_id not in (select stint_id from perf_stints where visit))),
    one as (select distinct on (lead_id, employee_id) * from e order by lead_id, employee_id, at desc)
    select jsonb_build_object('metric', p_metric, 'total', (select count(*) from one),
      'rows', coalesce((select jsonb_agg(r order by r ->> 'event_at' desc, r ->> 'stint_id') from (
        select jsonb_build_object('stint_id', o.stint_id, 'lead_id', o.lead_id, 'lead_name', l.name, 'employee_id', o.employee_id, 'employee_name', em.name,
          'lead_type', o.lead_type, 'source', o.source, 'project', o.project, 'origin', o.origin, 'assigned_at', p.assigned_at, 'event_at', o.at, 'event', o.kind,
          'last_result', p.last_result, 'last_stage', p.last_stage, 'visit', p.visit, 'converted', p.converted,
          'current_owner_id', l.current_owner_id, 'current_owner_name', co.name, 'lead_status', l.status, 'lead_stage', l.board_stage,
          'positive', coalesce(l.board_stage, 'LEADS') in ('FOLLOW_UP', 'VISIT', 'BOOKING') or l.status in ('CONNECTED', 'CONVERTED'),
          'available', l.status <> 'JUNK' and l.merged_into_lead_id is null) r
        from one o join leads l on l.id = o.lead_id join perf_stints p on p.stint_id = o.stint_id
        left join employees em on em.id = o.employee_id left join employees co on co.id = l.current_owner_id
        order by o.at desc, o.stint_id
        limit least(greatest(coalesce(p_limit, 200), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) z), '[]'::jsonb)));
end;
$$;

revoke all on function public.perf_event_rows_v4(date, date, jsonb), public.perf_event_group_v4(date, date, jsonb, text),
  public.perf_merge_v4(jsonb, jsonb, text[]), public.perf_merge_rows_v4(jsonb, date, date, jsonb, text, text, text[]) from public, anon, authenticated;
revoke all on function public.get_perf_report_v4(date, date, jsonb), public.get_perf_report_leads_v4(date, date, jsonb, text, int, int) from public, anon;
grant execute on function public.get_perf_report_v4(date, date, jsonb), public.get_perf_report_leads_v4(date, date, jsonb, text, int, int) to authenticated, service_role;

commit;
