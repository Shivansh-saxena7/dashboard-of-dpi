-- 2026-11-12 - "Needs your call": the caller's own leads the positive-history junk guard is holding back. NOT APPLIED: apply only
-- after the owner's "haan", from an LF copy (git show <commit>:<this file>). Rollback: 2026-11-12_my_guard_held_leads_rollback.sql
-- Read-only, additive: one function. Same rule as get_guard_held_leads (the System Health card), only for the caller's own
-- active assignment, and a lead the caller worked on after the last refusal drops off at once.
-- Result: lead id, positive kind, last refusal time. No name, number, note or other employee.
begin;

create or replace function public.get_my_guard_held_leads()
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_employee uuid := current_employee_id();
begin
  if v_employee is null then
    return jsonb_build_object('leads', '[]'::jsonb);
  end if;
  return (
    select jsonb_build_object('leads', coalesce(jsonb_agg(jsonb_build_object(
      'lead_id', l.id,
      'positive_kind', k.kind,
      'last_refused_at', r.last_at
    ) order by r.first_at, l.id), '[]'::jsonb))
    from leads l
    join lead_history h on h.lead_id = l.id and h.is_active and h.employee_id = v_employee
    join lateral (
      select min(g.created_at) first_at, max(g.created_at) last_at
      from lead_guard_events g
      where g.lead_id = l.id and g.source = 'db_positive_junk_guard' and g.action = 'JUNK_REFUSED' and g.created_at >= h.assigned_at
    ) r on r.last_at is not null
    cross join lateral (select lead_positive_history_kind(l.id) kind) k
    where l.current_owner_id = v_employee and l.status <> 'JUNK' and l.merged_into_lead_id is null and l.recycle_count >= 3
      and k.kind is not null and r.last_at > now() - interval '3 days'
      and (h.last_activity_at is null or h.last_activity_at <= r.last_at)
  );
end;
$$;

revoke all on function public.get_my_guard_held_leads() from public, anon;
grant execute on function public.get_my_guard_held_leads() to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
