-- Known-answer tests for 2026-11-02_restore_refusal_info.sql. Run ONLY inside a transaction that is never committed,
-- after the apply file (without its begin/commit). Every junk attempt runs in its own sub-block that is undone.
create temp table _t (n int, name text, pass boolean, info text) on commit drop;
create temp table _f on commit drop as select
  (select l.id from lead_restore_log r join leads l on l.id = r.lead_id join lead_history h on h.lead_id = l.id and h.is_active
   where r.undone_at is null and r.protected_until > now() and l.status <> 'JUNK' order by l.id limit 1) protected_lead,
  (select l.id from leads l join lead_history h on h.lead_id = l.id and h.is_active
   where l.status = 'CONNECTED' and not exists (select 1 from lead_restore_log r where r.lead_id = l.id) order by l.id limit 1) progress_lead,
  (select l.id from leads l join lead_history h on h.lead_id = l.id and h.is_active
   where l.status <> 'JUNK' and auto_junk_window_check(l.id, h.id) is null order by l.id limit 1) junkable_lead;
-- one junk attempt as the sweep makes it; returns "<status after>|<guard events>|<info +>|<error +>"
create or replace function pg_temp.probe(p_lead uuid) returns text language plpgsql as $$
declare v_h uuid; v text; a0 bigint; b0 bigint; n0 bigint; ev bigint; a1 bigint; b1 bigint; n1 bigint; st text;
begin
  begin
    select id into v_h from lead_history where lead_id = p_lead and is_active;
    select coalesce(sum(occurrence_count), 0) into a0 from system_anomaly_log where source = 'db_auto_junk_guard' and severity = 'info';
    select coalesce(sum(occurrence_count), 0) into b0 from system_anomaly_log where source = 'db_auto_junk_guard' and severity = 'error';
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform mark_lead_junk_atomic(p_lead, v_h, 'max recycles reached');
    select status into st from leads where id = p_lead;
    select count(*) into ev from lead_guard_events where lead_id = p_lead and action = 'JUNK_REFUSED' and created_at = now();
    select coalesce(sum(occurrence_count), 0) into a1 from system_anomaly_log where source = 'db_auto_junk_guard' and severity = 'info';
    select coalesce(sum(occurrence_count), 0) into b1 from system_anomaly_log where source = 'db_auto_junk_guard' and severity = 'error';
    raise exception 'PROBE %|%|%|%', st, ev, a1 - a0, b1 - b0;
  exception when others then
    if sqlerrm like 'PROBE %' then return substr(sqlerrm, 7); end if;
    return 'ERROR ' || left(sqlerrm, 90);
  end;
end $$;
insert into _t select 1, 'fixtures: protected, progress and junkable lead', protected_lead is not null and progress_lead is not null and junkable_lead is not null, null from _f;
insert into _t select 2, 'protected lead: refused as before, guard event, logged as info, no error', pg_temp.probe(protected_lead) = (select status from leads where id = protected_lead) || '|1|1|0', pg_temp.probe(protected_lead) from _f;
insert into _t select 3, 'other refusal (lead has progress): refused as before, still error', pg_temp.probe(progress_lead) = 'CONNECTED|1|0|1', pg_temp.probe(progress_lead) from _f;
insert into _t select 4, 'junk the guard allows: still junked, nothing logged', pg_temp.probe(junkable_lead) = 'JUNK|0|0|0', pg_temp.probe(junkable_lead) from _f;
insert into _t select 5, 'grants unchanged, exactly one line differs', (select proacl::text from pg_proc where oid = 'mark_lead_junk_atomic(uuid,uuid,text)'::regprocedure) = '{postgres=X/postgres,service_role=X/postgres}'
  and pg_get_functiondef('mark_lead_junk_atomic(uuid,uuid,text)'::regprocedure) like '%then ''info'' else ''error'' end,%', null;
