-- APPLIED 2026-11-15 12:52 IST, live (anon lost TRUNCATE, TRIGGER, REFERENCES, MAINTAIN on 87 tables/views).
-- Rollback: 2026-11-15_anon_revoke_partial_rollback.sql.
-- 2026-11-15. Partial anon revoke (step 1 of 2): anon loses TRUNCATE, TRIGGER, REFERENCES and MAINTAIN on every
-- table and view in public. None of them is reachable through the API (PostgREST never issues them), and TRUNCATE
-- would bypass RLS. SELECT / INSERT / UPDATE / DELETE, sequences and functions are NOT touched here (the full revoke
-- is 2026-11-15_anon_revoke.sql, held until anon page-load queries are gone). Apply from an LF copy, rolled-back dry
-- run first, between sweeps. Rollback: 2026-11-15_anon_revoke_partial_rollback.sql.
begin;

revoke truncate, trigger, references, maintain on all tables in schema public from anon;

do $$
declare n int;
begin
  select count(*) into n from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
      and a.grantee = 'anon'::regrole and a.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN');
  if n > 0 then raise exception 'anon still has % of these grants', n; end if;
  if not has_table_privilege('anon', 'public.leads', 'SELECT') then raise exception 'anon SELECT must be untouched in this step'; end if;
  if not has_table_privilege('authenticated', 'public.leads', 'SELECT') then raise exception 'authenticated lost leads'; end if;
end $$;

commit;
