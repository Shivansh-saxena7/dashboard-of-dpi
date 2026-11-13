-- NOT APPLIED. 2026-11-13. Apply only on the owner's "haan", from an LF copy (git show), AFTER Admin has reassigned
-- these 2 leads from Muskan (inactive) to an active employee. Makes them ordinary leads (is_personal_lead = false) so
-- the normal timers and recycling apply to the new owner; personal leads never recycle. Only these 2 ids, only while
-- still personal, and refuses while either is still owned by an inactive employee.
-- Rollback: 2026-11-13_muskan_personal_off_rollback.sql.
begin;

do $$
declare n int;
begin
  if exists (
    select 1 from public.leads l join public.employees e on e.id = l.current_owner_id
     where l.id in ('4490af26-a73d-4604-bf04-5a6765a142ac', '9b609f02-b6e0-42ec-a309-c2d287317fa8') and not e.is_active
  ) then
    raise exception 'reassign both leads to an active employee first';
  end if;
  update public.leads
     set is_personal_lead = false
   where id in ('4490af26-a73d-4604-bf04-5a6765a142ac', '9b609f02-b6e0-42ec-a309-c2d287317fa8')
     and is_personal_lead = true;
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'expected 2 personal leads, updated %', n; end if;
end $$;

commit;
