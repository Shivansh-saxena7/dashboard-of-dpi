-- APPLIED 2026-11-16 14:33 IST, live (full anon revoke, on top of the partial revoke of 15 Nov): anon has no grant on any
-- of the 91 public relations (82 tables, 5 views, 4 sequences), no EXECUTE on the 6 RLS helpers (PUBLIC neither),
-- and no default privileges in public. The "DRAFT / NOT APPLIED" note below is from before the apply.
-- Rollback: 2026-11-16_anon_revoke_full_rollback.sql (back to the state just before this revoke, i.e. after the
-- partial revoke). 2026-11-15_anon_revoke_rollback.sql goes further back, to 15 Nov before the partial revoke.
-- DRAFT / NOT APPLIED. 2026-11-15. Apply only on the owner's "haan": LF copy (git cat-file -p), rolled-back dry run
-- first, between sweeps. Rollback: 2026-11-15_anon_revoke_rollback.sql (restores the exact grants captured on 15 Nov).
-- Defense in depth for the anon role (no login). Today anon has every privilege (incl. TRUNCATE) on 87 public tables
-- and views and on 4 sequences, protected only by RLS, and EXECUTE on the 6 RLS helper functions. The app never
-- talks to the database without a login (login page reads employees only after signInWithPassword; API routes and
-- Edge Functions use the caller's JWT or the service role), so anon needs none of it. After this: an anon request
-- gets "permission denied" at the table instead of an empty RLS answer. authenticated and service_role keep
-- exactly what they have. Future tables / sequences created by postgres in public no longer grant anon by default.
-- Nothing is dropped; RLS policies are unchanged.
begin;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

revoke execute on function public.current_employee_department(), public.current_employee_id(), public.current_employee_role(), public.current_employee_team_id(), public.is_admin(), public.is_super_admin() from public, anon;
grant execute on function public.current_employee_department(), public.current_employee_id(), public.current_employee_role(), public.current_employee_team_id(), public.is_admin(), public.is_super_admin() to authenticated, service_role;

alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

do $$
declare n int;
begin
  select count(*) into n from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'S')
      and exists (select 1 from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where a.grantee = 'anon'::regrole);
  if n > 0 then raise exception 'anon still has privileges on % relations', n; end if;
  select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE');
  if n > 0 then raise exception 'anon can still execute % functions', n; end if;
  if not has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.current_employee_id()', 'EXECUTE') then
    raise exception 'authenticated lost a helper';
  end if;
  if not has_table_privilege('authenticated', 'public.leads', 'SELECT') then raise exception 'authenticated lost leads'; end if;
end $$;

commit;
