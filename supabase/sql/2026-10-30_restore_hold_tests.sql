-- Known-answer tests for 2026-10-30_restore_hold.sql. Run ONLY inside a transaction that is never committed:
--   begin; <apply file without its begin/commit>; <this file>;
--   do $$ begin raise exception 'DRYRUN_RESULT %', (select json_agg(t order by n) from _t t); end $$;
-- Every recycle below runs in its own sub-block that is undone before the next one.
create temp table _t (n int, name text, pass boolean, info text) on commit drop;
create temp table _f on commit drop as
with prot as (
  select l.id lead, h.id hist, l.lead_type, l.current_owner_id owner
  from lead_restore_log r join leads l on l.id = r.lead_id join lead_history h on h.lead_id = l.id and h.is_active
  where r.undone_at is null and r.protected_until > now() and l.status <> 'JUNK'
), tgt as (
  select e.id from employees e where e.is_active and e.role = 'employee' and e.department = 'sales'
)
select
  (select p.lead from prot p where p.lead_type <> 'DATA' and positive_sibling_block(p.lead, (select id from tgt where id <> p.owner order by id limit 1)) is null order by p.lead limit 1) p_lead,
  (select p.lead from prot p where p.lead_type = 'DATA' order by p.lead limit 1) d_lead,
  (select l.id from leads l join lead_history h on h.lead_id = l.id and h.is_active
   where l.lead_type <> 'DATA' and l.status not in ('JUNK', 'CONVERTED') and coalesce(l.board_stage, 'LEADS') = 'LEADS'
     and not exists (select 1 from lead_restore_log r where r.lead_id = l.id)
     and positive_sibling_block(l.id, (select id from tgt where id <> l.current_owner_id order by id limit 1)) is null
   order by l.id limit 1) u_lead;

-- recycles one lead as the sweep does (service_role) under the given mode; returns "<moved>|<events of this run>"
create or replace function pg_temp.try_recycle(p_lead uuid, p_mode text, p_as_sweep boolean) returns text language plpgsql as $$
declare v_hist uuid; v_owner uuid; v_to uuid; v_after uuid; v_ev text;
begin
  select h.id, l.current_owner_id into v_hist, v_owner from leads l join lead_history h on h.lead_id = l.id and h.is_active where l.id = p_lead;
  select id into v_to from employees where is_active and role = 'employee' and department = 'sales' and id <> v_owner order by id limit 1;
  update lead_engine_settings set restore_hold_mode = p_mode where id = 1;
  perform set_config('request.jwt.claims', case when p_as_sweep then '{"role":"service_role"}' else '' end, true);
  perform set_config('request.jwt.claim.role', case when p_as_sweep then 'service_role' else '' end, true);
  perform recycle_lead_atomic(p_lead, v_hist, v_to, null, null, 'FOLLOWUP_INACTIVITY_RECYCLE_READY');
  select current_owner_id into v_after from leads where id = p_lead;
  select coalesce(string_agg(action, ','), '-') into v_ev from lead_guard_events where source = 'db_restore_hold' and lead_id = p_lead and created_at = now();
  return (v_after = v_to)::text || '|' || v_ev;
end $$;
-- runs try_recycle and undoes everything it did
create or replace function pg_temp.probe(p_lead uuid, p_mode text, p_as_sweep boolean) returns text language plpgsql as $$
declare v text;
begin
  begin
    v := pg_temp.try_recycle(p_lead, p_mode, p_as_sweep);
    raise exception 'PROBE %', v;
  exception when others then
    if sqlerrm like 'PROBE %' then return substr(sqlerrm, 7); end if;
    return 'ERROR ' || left(sqlerrm, 80);
  end;
end $$;

insert into _t select 1, 'fixtures: protected LEAD, protected DATA, unprotected LEAD', p_lead is not null and d_lead is not null and u_lead is not null, null from _f;
insert into _t select 2, 'setting added with default shadow', (select restore_hold_mode from lead_engine_settings where id = 1) = 'shadow', null;
insert into _t select 3, 'helper: service_role only (no PUBLIC / anon / authenticated)',
  has_function_privilege('service_role', 'restore_protection_until(uuid)', 'execute') and not has_function_privilege('anon', 'restore_protection_until(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'restore_protection_until(uuid)', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'restore_protection_until(uuid)'::regprocedure and a.grantee = 0),
  (select proacl::text from pg_proc where oid = 'restore_protection_until(uuid)'::regprocedure);
insert into _t select 4, 'recycle_lead_atomic grants unchanged, no CR in bodies',
  (select proacl::text from pg_proc where oid = 'recycle_lead_atomic(uuid,uuid,uuid,uuid,uuid,text)'::regprocedure) = '{postgres=X/postgres,service_role=X/postgres}'
  and position(chr(13) in pg_get_functiondef('recycle_lead_atomic(uuid,uuid,uuid,uuid,uuid,text)'::regprocedure) || pg_get_functiondef('restore_protection_until(uuid)'::regprocedure)) = 0, null;
insert into _t select 5, 'helper: every open window found, unprotected lead = null',
  (select count(*) from lead_restore_log r where r.undone_at is null and r.protected_until > now() and restore_protection_until(r.lead_id) is null) = 0
  and restore_protection_until(u_lead) is null,
  (select count(distinct lead_id) from lead_restore_log r where r.undone_at is null and r.protected_until > now())::text from _f;
insert into _t select 6, 'shadow: protected LEAD recycles as before + RECYCLE_WOULD_REFUSE', pg_temp.probe(p_lead, 'shadow', true) = 'true|RECYCLE_WOULD_REFUSE', pg_temp.probe(p_lead, 'shadow', true) from _f;
insert into _t select 7, 'enforce: protected LEAD refused, owner unchanged + RECYCLE_REFUSED', pg_temp.probe(p_lead, 'enforce', true) = 'false|RECYCLE_REFUSED', pg_temp.probe(p_lead, 'enforce', true) from _f;
insert into _t select 8, 'off: protected LEAD recycles, no event', pg_temp.probe(p_lead, 'off', true) = 'true|-', pg_temp.probe(p_lead, 'off', true) from _f;
insert into _t select 9, 'enforce: unprotected LEAD recycles normally, no event', pg_temp.probe(u_lead, 'enforce', true) = 'true|-', pg_temp.probe(u_lead, 'enforce', true) from _f;
insert into _t select 10, 'enforce: protected DATA lead never held', pg_temp.probe(d_lead, 'enforce', true) = 'true|-', pg_temp.probe(d_lead, 'enforce', true) from _f;
insert into _t select 11, 'enforce: non-sweep caller not affected', pg_temp.probe(p_lead, 'enforce', false) = 'true|-', pg_temp.probe(p_lead, 'enforce', false) from _f;
create or replace function pg_temp.bad_mode() returns text language plpgsql as $$
begin
  begin
    update lead_engine_settings set restore_hold_mode = 'bogus' where id = 1;
    return 'accepted';
  exception when check_violation then return 'refused';
  end;
end $$;
insert into _t select 12, 'settings check rejects an unknown mode', pg_temp.bad_mode() = 'refused', pg_temp.bad_mode();
