-- DRAFT, NOT APPLIED (2026-11-28, feature/admin-lead-name-number). Apply only on the owner's "haan", from an LF copy
-- (git cat-file -p), CR count 0, rolled-back dry run first, at least 2 minutes away from a sweep (:00/:15/:30/:45 IST)
-- and the perf refresh (:37 IST).
-- Why: the admin "Positive-history junk" page and the Performance Report "Lead Journey" tab show only a short lead id.
-- The owner wants the lead's name and mobile next to it to cross-check. Additive: one new read-only lookup, nothing
-- existing changes (get_positive_junk_leads, get_perf_journey_rows and every other function stay as they are).
--   get_admin_lead_contacts(p_lead_ids uuid[]) -> (lead_id, name, mobile) for those leads only.
--   * SECURITY DEFINER, search_path pinned, refuses everyone except is_admin() (active admin / super_admin): 42501.
--   * Bounded: 1..200 ids per call (the app sends the ids in the POST body, in chunks of 200), else 22023.
--   * EXECUTE revoked from PUBLIC and anon, granted to authenticated only (the is_admin() check still applies).
-- No table grant or policy changes. Rollback: 2026-11-29_admin_lead_contacts_rollback.sql.
begin;

create or replace function public.get_admin_lead_contacts(p_lead_ids uuid[])
returns table (lead_id uuid, name text, mobile text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not coalesce((select public.is_admin()), false) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_lead_ids is null or cardinality(p_lead_ids) < 1 or cardinality(p_lead_ids) > 200 then
    raise exception 'send 1 to 200 lead ids' using errcode = '22023';
  end if;
  return query
    select l.id, l.name::text, l.mobile::text
      from public.leads l
     where l.id = any (p_lead_ids);
end;
$$;

revoke all on function public.get_admin_lead_contacts(uuid[]) from public;
revoke all on function public.get_admin_lead_contacts(uuid[]) from anon;
grant execute on function public.get_admin_lead_contacts(uuid[]) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.get_admin_lead_contacts(uuid[])', 'EXECUTE') then
    raise exception 'anon can still execute';
  end if;
end $$;

commit;
