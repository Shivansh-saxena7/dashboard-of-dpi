-- 2026-11-03 - Admin list of the leads the positive-history junk guard is holding back. NOT APPLIED: apply only after the
-- owner's "haan", from an LF copy (git show <commit>:<this file>). Rollback: 2026-11-03_guard_held_leads_rollback.sql
-- Read-only, additive: one function, no table, no setting, no existing function changed.
-- Held = positive_junk_guard_check refused this lead in enforce mode on the current assignment, it is still not junk and the
-- sweep refused it again within the last 3 days (it retries every 24 hours while the lead stays due, and rests on
-- non-working days). A lead the owner worked on stops being refused and drops off. No mobile number in the result.
begin;

create or replace function public.get_guard_held_leads()
returns table (
  lead_id8 text,
  lead_name text,
  owner_name text,
  recycle_count int,
  positive_kind text,
  last_activity_at timestamptz,
  first_refused_at timestamptz,
  last_refused_at timestamptz,
  days_refused int
)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin') then
    raise exception 'get_guard_held_leads: admin only' using errcode = '42501';
  end if;
  return query
  select left(l.id::text, 8), l.name::text, e.name::text, l.recycle_count::int, k.kind, h.last_activity_at, r.first_at, r.last_at,
         floor(extract(epoch from now() - r.first_at) / 86400)::int
  from leads l
  join lead_history h on h.lead_id = l.id and h.is_active
  left join employees e on e.id = l.current_owner_id
  join lateral (
    select min(g.created_at) first_at, max(g.created_at) last_at
    from lead_guard_events g
    where g.lead_id = l.id and g.source = 'db_positive_junk_guard' and g.action = 'JUNK_REFUSED' and g.created_at >= h.assigned_at
  ) r on r.last_at is not null
  cross join lateral (select lead_positive_history_kind(l.id) kind) k
  where l.status <> 'JUNK' and l.merged_into_lead_id is null and l.recycle_count >= 3 and k.kind is not null
    and r.last_at > now() - interval '3 days'
  order by r.first_at, l.id;
end;
$$;

revoke all on function public.get_guard_held_leads() from public, anon;
grant execute on function public.get_guard_held_leads() to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
