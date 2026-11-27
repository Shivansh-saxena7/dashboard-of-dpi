-- DRAFT, NOT APPLIED (2026-11-27, feature/admin-home-engine-rpc). Apply only on the owner's "haan", from an LF copy
-- (git cat-file -p), CR count 0, rolled-back dry run first, at least 2 minutes away from a sweep (:00/:15/:30/:45 IST)
-- and the perf refresh (:37 IST).
-- Why: the Admin Home "Lead engine" tile read public.lead_guard_events directly, but no client role has a grant on that
-- table, so every admin got 42501 and the tile showed "Couldn't load...". This read-only function gives admins only
-- per (source, action) counts for one time window. lead_guard_events grants and policies are NOT changed.
--   * SECURITY DEFINER, search_path pinned, refuses everyone except is_admin() (active admin / super_admin).
--   * Bounded: p_from and p_to required, p_to > p_from, window at most 3 days. No row limit is needed (it returns groups).
--   * EXECUTE revoked from PUBLIC and anon, granted to authenticated only (the is_admin() check still applies).
-- Rollback: 2026-11-28_admin_guard_event_counts_rollback.sql.
begin;

create or replace function public.get_admin_guard_event_counts(p_from timestamptz, p_to timestamptz)
returns table (source text, action text, n bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not coalesce((select public.is_admin()), false) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '3 days' then
    raise exception 'window must be set, start before end, at most 3 days' using errcode = '22023';
  end if;
  return query
    select g.source, g.action, count(*)::bigint
      from public.lead_guard_events g
     where g.created_at >= p_from and g.created_at < p_to
     group by g.source, g.action
     order by g.source, g.action;
end;
$$;

revoke all on function public.get_admin_guard_event_counts(timestamptz, timestamptz) from public;
revoke all on function public.get_admin_guard_event_counts(timestamptz, timestamptz) from anon;
grant execute on function public.get_admin_guard_event_counts(timestamptz, timestamptz) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.get_admin_guard_event_counts(timestamptz, timestamptz)', 'EXECUTE') then
    raise exception 'anon can still execute';
  end if;
  if has_table_privilege('authenticated', 'public.lead_guard_events', 'SELECT')
     or has_table_privilege('anon', 'public.lead_guard_events', 'SELECT') then
    raise exception 'lead_guard_events grants changed (must stay closed)';
  end if;
end $$;

commit;
