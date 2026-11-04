-- 2026-11-04 - "Previously connected" for the employee Data page. NOT APPLIED: apply only after the owner's "haan", from an LF
-- copy (git show <commit>:<this file>). Rollback: 2026-11-04_data_previous_positive_rollback.sql
-- Read-only, additive: one function, nothing else changes. Works for the caller's own active DATA leads only.
-- For each, the last positive result on the same number, on any copy of it (a closed JUNK or merged copy too), before the
-- caller's current assignment of that lead, and the latest result after it. get_given_lead_context cannot do this: it only
-- covers a lead an admin gave back, and only that lead's own history.
-- Result carries a kind, a date and whether it was the caller. No employee name, no client name, no number, no note.
begin;

create or replace function public.get_data_previous_positive()
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_employee uuid := current_employee_id();
begin
  if v_employee is null then
    return jsonb_build_object('leads', '[]'::jsonb);
  end if;
  return (
    with mine as (
      select l.id lead_id, l.mobile_normalized m, h.assigned_at
      from leads l
      join lead_history h on h.lead_id = l.id and h.is_active and h.employee_id = v_employee
      where l.current_owner_id = v_employee and l.lead_type = 'DATA' and l.status <> 'JUNK' and l.merged_into_lead_id is null
        and l.mobile_normalized ~ '^[0-9]{10}$'
    )
    select jsonb_build_object('leads', coalesce(jsonb_agg(jsonb_build_object(
      'lead_id', m.lead_id,
      'last_positive', jsonb_build_object('kind', lp.kind, 'at', lp.at_, 'is_you', lp.by_id is not distinct from v_employee),
      'after', case when af.at_ is null then null else jsonb_build_object('outcome', af.detail, 'at', af.at_) end
    ) order by lp.at_ desc), '[]'::jsonb))
    from mine m
    cross join lateral (
      select e.kind, e.at_, e.by_id from leads s
      cross join lateral (
        select a.detail kind, a.created_at at_, a.employee_id by_id from lead_activity_log a
          where a.lead_id = s.id
            and ((a.activity_type = 'STATUS_UPDATE' and a.detail in ('CONNECTED', 'CONVERTED'))
              or (a.activity_type = 'BOARD_STAGE_MOVE' and a.detail in ('FOLLOW_UP', 'VISIT', 'BOOKING')))
        union all
        select case when v.event_type = 'BOOKED' then 'BOOKING' else 'VISIT' end, v.created_at, v.employee_id from site_visits v
          where v.lead_id = s.id and v.denied_at is null
        union all
        select h.outcome, h.outcome_at, h.employee_id from lead_history h
          where h.lead_id = s.id and h.outcome in ('CONNECTED', 'CONVERTED') and h.outcome_at is not null
      ) e
      where s.mobile_normalized = m.m and (s.id <> m.lead_id or e.at_ < m.assigned_at)
      order by e.at_ desc limit 1
    ) lp
    left join lateral (
      select a.detail, a.created_at at_ from leads s
      join lead_activity_log a on a.lead_id = s.id and a.activity_type = 'STATUS_UPDATE' and a.created_at > lp.at_
      where s.mobile_normalized = m.m and (s.id <> m.lead_id or a.created_at < m.assigned_at)
      order by a.created_at desc limit 1
    ) af on true
  );
end;
$$;

revoke all on function public.get_data_previous_positive() from public, anon;
grant execute on function public.get_data_previous_positive() to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
