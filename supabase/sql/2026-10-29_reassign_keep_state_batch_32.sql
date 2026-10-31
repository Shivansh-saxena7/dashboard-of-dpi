-- 2026-10-29 batch: 32 positive leads of inactive owners -> active employees. RAN 2026-10-29 18:01:15 IST (owner's "haan"), 32/32 REASSIGNED.
-- Undo: 2026-10-29_reassign_keep_state_undo.sql with @@SINCE@@ = 2026-10-29 12:31:15+00. Pre-state backup: C:/work/reports/reassign_keep_state_pre_2026-10-29.json
begin;
create temp table _m (id8 text, who text, t text);
insert into _m values
 ('3377376c','Muskan Purohit','LEAD'),
 ('1f2ab101','Muskan Purohit','LEAD'),('586d0821','Muskan Purohit','LEAD'),('76473407','Muskan Purohit','LEAD'),('be4cd741','Muskan Purohit','LEAD'),
 ('c613ce4d','Tanu Mishra','LEAD'),('d0b2222e','Tanu Mishra','LEAD'),('d2c96368','Tanu Mishra','LEAD'),('e4437d50','Tanu Mishra','LEAD'),('ef3fb785','Tanu Mishra','LEAD'),
 ('3c9753ec','Muskan Purohit','LEAD'),('e4b701b8','Tanu Mishra','LEAD'),
 ('8e31fa8c','Muskan Purohit','DATA'),('10c8be50','Muskan Purohit','DATA'),('768f7f6c','Himanshu Singh','DATA'),('d3e4fe5f','Himanshu Singh','DATA'),
 ('9e15d3b7','Himanshu Singh','DATA'),('b1386158','Himanshu Singh','DATA'),('c69b494f','Himanshu Singh','DATA'),('f8651409','Himanshu Singh','DATA'),
 ('322713d6','Himanshu Singh','DATA'),('5f0261f0','Himanshu Singh','DATA'),
 ('69c23333','Muskan Purohit','DATA'),('8eafb67b','Muskan Purohit','DATA'),('8fd60c62','Muskan Purohit','DATA'),('905d6020','Muskan Purohit','DATA'),
 ('a8223257','Tanu Mishra','DATA'),('b34d563f','Tanu Mishra','DATA'),('ccb41ce4','Tanu Mishra','DATA'),('d60eeb8c','Tanu Mishra','DATA'),('dbd2f3b5','Tanu Mishra','DATA'),('f6a6db10','Tanu Mishra','DATA');
create temp table _b as
select m.*, l.id lead, l.status, coalesce(l.board_stage, 'LEADS') stage, l.recycle_count rc, h.id hist, h.paused_until, h.pause_reason,
  (select id from employees e where e.name ilike m.who || '%' and e.is_active) target
from _m m join leads l on left(l.id::text, 8) = m.id8 left join lead_history h on h.lead_id = l.id and h.is_active;
create temp table _res (id8 text, res jsonb);
select set_config('request.jwt.claim.sub', (select auth_user_id::text from employees where role = 'admin' and is_active order by created_at limit 1), true),
       set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from employees where role = 'admin' and is_active order by created_at limit 1), 'role', 'authenticated')::text, true);
do $$ declare b record; begin
  if (select count(*) from _b where target is not null and hist is not null) <> 32 then raise exception 'ABORT: fixtures %', (select count(*) from _b); end if;
  for b in select * from _b order by id8 loop
    insert into _res values (b.id8, reassign_keep_state_atomic(b.lead, b.target, 'Reassigned: previous owner inactive, positive lead, please read notes and call'));
  end loop;
end $$;
-- every check must hold or the whole batch rolls back (nothing committed)
do $$ declare v_bad text; begin
  select string_agg(b.id8, ',') into v_bad
  from _b b join leads l on l.id = b.lead join _res r on r.id8 = b.id8 left join lead_history h on h.lead_id = l.id and h.is_active
  where not (r.res->>'result' = 'REASSIGNED' and l.current_owner_id = b.target and l.status = b.status and coalesce(l.board_stage, 'LEADS') = b.stage
    and l.recycle_count = b.rc and h.paused_until is not distinct from b.paused_until and h.pause_reason is not distinct from b.pause_reason
    and (select count(*) from lead_history x where x.lead_id = l.id and x.is_active) = 1
    and (select count(*) from lead_activity_log a where a.lead_id = l.id and a.activity_type = 'ADMIN_REASSIGN') = 1
    and (select count(*) from notification n where n.related_lead_id = l.id and n.employee_id = b.target and n.created_at = now()) = 1
    and (select count(*) from lead_guard_events g where g.lead_id = l.id and g.action = 'ADMIN_REASSIGN') = 1
    and auto_junk_window_check(l.id, h.id) like 'restored by an admin, protected until%');
  if v_bad is not null then raise exception 'ABORT: check failed for %', v_bad; end if;
end $$;
select now() applied_at, count(*) filter (where res->>'result' = 'REASSIGNED') reassigned, count(*) total from _res;
commit;
