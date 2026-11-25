-- 2026-11-27 Lead Journey Excel lists. DRAFT, NOT APPLIED. Apply only on the owner's "haan", from an LF copy, after a
-- rolled-back dry run, at least 2 minutes away from a recycle sweep (:00/:15/:30/:45 IST) and the hourly refresh (:37 IST).
-- Rollback: 2026-11-27_perf_journey_export_rollback.sql. Additive: 2 new functions; nothing live is changed.
-- For the admin's Excel only: one page (at most 500 leads) of the journeys with the lead's name and mobile (the Excel
-- says "Contains customer data: do not share"), every assignment (up to 50) and the date it became positive, so the file
-- can list each "Missed by me" / "Won from others" / "Assist" lead. Same cohort, order and flags as get_perf_journey_rows.
begin;

create or replace function public.perf_journey_export_json(p_from date, p_to date, p_filters jsonb, p_limit int, p_offset int)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with x as materialized (select * from perf_journey_stints_v1(p_from, p_to, p_filters)),
  pick as (select lead_id, min(assigned_at) as first_at from x where in_cohort group by lead_id),
  page as (select * from pick order by first_at desc, lead_id
           limit least(greatest(coalesce(p_limit, 500), 1), 500) offset greatest(coalesce(p_offset, 0), 0)),
  ls as (
    select x.lead_id, count(*) as owners,
      (array_agg(x.source order by x.seq desc))[1] as source,
      jsonb_agg(jsonb_build_object('seq', x.seq, 'employee_id', x.employee_id, 'name', em.name, 'origin', x.origin,
        'assigned_at', x.assigned_at, 'ended_at', x.ended_at, 'days', x.days_held, 'calls', x.calls, 'worked', x.worked,
        'positive', x.positive, 'pos_at', x.pos_at, 'result', coalesce(x.pos_kind, x.last_result, 'NO_RESULT'), 'move', x.move,
        'excused', x.excused, 'in_range', x.in_cohort, 'missed', x.missed, 'won', x.won, 'assist', x.assist) order by x.seq) filter (where x.seq <= 50) as steps
    from x join page pg on pg.lead_id = x.lead_id left join employees em on em.id = x.employee_id
    group by x.lead_id)
  select jsonb_build_object('total', (select count(*) from pick),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('lead_id', pg.lead_id, 'lead_short', left(pg.lead_id::text, 8), 'first_at', pg.first_at,
        'lead_name', l.name, 'mobile', l.mobile, 'lead_type', l.lead_type, 'source', ls.source, 'project', l.project, 'status', l.status,
        'stage', l.board_stage, 'available', l.status <> 'JUNK' and l.merged_into_lead_id is null, 'owners', ls.owners, 'steps', ls.steps)
        order by pg.first_at desc, pg.lead_id)
      from page pg join leads l on l.id = pg.lead_id join ls on ls.lead_id = pg.lead_id), '[]'::jsonb))
$$;

create or replace function public.get_perf_journey_export(p_from date, p_to date, p_filters jsonb, p_limit int default 500, p_offset int default 0)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not coalesce((select is_admin()), false) then raise exception 'perf report: admin only'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 800 then raise exception 'perf report: bad date range'; end if;
  return perf_journey_export_json(p_from, p_to, p_filters, p_limit, p_offset);
end;
$$;

revoke all on function public.perf_journey_export_json(date, date, jsonb, int, int) from public, anon, authenticated;
revoke all on function public.get_perf_journey_export(date, date, jsonb, int, int) from public, anon;
grant execute on function public.get_perf_journey_export(date, date, jsonb, int, int) to authenticated, service_role;

commit;
