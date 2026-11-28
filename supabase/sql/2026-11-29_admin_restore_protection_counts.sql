-- DRAFT, NOT APPLIED (2026-11-28, feature/admin-home-restore-rpc). Apply only on the owner's "haan", from an LF copy
-- (git cat-file -p), CR count 0, rolled-back dry run first, at least 2 minutes away from a sweep (:00/:15/:30/:45 IST)
-- and the perf refresh (:37 IST).
-- Why: the Admin Home "Lead engine" tile also read public.lead_restore_log directly, and no client role has a grant on
-- that table, so every admin got 42501 and the tile showed "Couldn't load..." (the second cause after lead_guard_events,
-- fixed by get_admin_guard_event_counts). This read-only function gives admins only counts:
--   open_now        restore protections open at p_at
--   open_day_before restore protections open 24 hours before p_at
--   earliest_end    the earliest protected_until among the ones open at p_at (a date, no lead id)
-- "Open at t" is the Home's own rule (lib/adminHome.ts openProtections): protected_until > t, restored by t (or no
-- restored_at), not undone by t (or no undone_at).
--   * SECURITY DEFINER, search_path pinned, refuses everyone except is_admin() (active admin / super_admin).
--   * Bounded: p_at required and within now() - 2 days .. now() + 1 hour. No row limit needed (it returns one row).
--   * EXECUTE revoked from PUBLIC and anon, granted to authenticated only (the is_admin() check still applies).
-- lead_restore_log grants and policies are NOT changed. Rollback: 2026-11-29_admin_restore_protection_counts_rollback.sql.
begin;

create or replace function public.get_admin_restore_protection_counts(p_at timestamptz)
returns table (open_now bigint, open_day_before bigint, earliest_end timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not coalesce((select public.is_admin()), false) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_at is null or p_at < now() - interval '2 days' or p_at > now() + interval '1 hour' then
    raise exception 'p_at must be set and within the last 2 days' using errcode = '22023';
  end if;
  return query
    select
      count(*) filter (where r.protected_until > p_at
                         and (r.restored_at is null or r.restored_at <= p_at)
                         and (r.undone_at is null or r.undone_at > p_at))::bigint,
      count(*) filter (where r.protected_until > p_at - interval '24 hours'
                         and (r.restored_at is null or r.restored_at <= p_at - interval '24 hours')
                         and (r.undone_at is null or r.undone_at > p_at - interval '24 hours'))::bigint,
      min(r.protected_until) filter (where r.protected_until > p_at
                         and (r.restored_at is null or r.restored_at <= p_at)
                         and (r.undone_at is null or r.undone_at > p_at))
    from public.lead_restore_log r
    where r.protected_until > p_at - interval '24 hours';
end;
$$;

revoke all on function public.get_admin_restore_protection_counts(timestamptz) from public;
revoke all on function public.get_admin_restore_protection_counts(timestamptz) from anon;
grant execute on function public.get_admin_restore_protection_counts(timestamptz) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.get_admin_restore_protection_counts(timestamptz)', 'EXECUTE') then
    raise exception 'anon can still execute';
  end if;
  if has_table_privilege('authenticated', 'public.lead_restore_log', 'SELECT')
     or has_table_privilege('anon', 'public.lead_restore_log', 'SELECT') then
    raise exception 'lead_restore_log grants changed (must stay closed)';
  end if;
end $$;

commit;
