-- Known-answer tests for 2026-10-29_positive_junk_restore.sql. Run ONLY inside a transaction that is never committed:
--   begin; <apply file without its begin/commit>; <this file>;
--   do $$ begin raise exception 'DRYRUN_RESULT %', (select string_agg(...) from _t); end $$;
-- Uses two real positive-history junk leads (restored only inside the rolled-back transaction) and synthetic
-- sibling / DATA-copy rows that never survive the transaction.
create temp table _t (n int, name text, pass boolean, info text) on commit drop;
create temp table _c on commit drop as
select (select id from leads where left(id::text, 8) = '015f262e') x,
       (select id from leads where left(id::text, 8) = 'ca1a4d68') y,
       (select id from employees where name = 'Muskan Purohit') muskan,
       (select id from employees where name ilike 'Kashish%') kashish,
       (select id from employees where name = 'Sonendra Sharma') sonendra,
       (select auth_user_id from employees where role = 'admin' and is_active limit 1) admin_auth,
       (select auth_user_id from employees where role = 'employee' and department = 'sales' and is_active limit 1) emp_auth;
create or replace function pg_temp.as_user(p_auth uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_auth::text, ''), true),
         set_config('request.jwt.claims', case when p_auth is null then '' else json_build_object('sub', p_auth, 'role', 'authenticated')::text end, true)
$$;
create or replace function pg_temp.items(p_lead uuid, p_emp uuid) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('lead_id', p_lead, 'employee_id', p_emp))
$$;
insert into _t select 0, 'fixtures found', x is not null and y is not null and muskan is not null and kashish is not null and sonendra is not null, null from _c;

-- ---------------- access
select pg_temp.as_user(emp_auth) from _c;
do $$ begin perform get_positive_junk_leads(); insert into _t values (1, 'employee cannot list', false, 'ran');
exception when others then insert into _t values (1, 'employee cannot list', sqlerrm like '%admin only%', left(sqlerrm, 60)); end $$;
do $$ begin perform restore_positive_junk_leads(pg_temp.items((select x from _c), (select muskan from _c)), 'test reason');
  insert into _t values (2, 'employee cannot restore', false, 'ran');
exception when others then insert into _t values (2, 'employee cannot restore', sqlerrm like '%admin only%', left(sqlerrm, 60)); end $$;
do $$ declare e text; begin
  set local role anon;
  begin perform get_positive_junk_leads(); e := 'ran'; exception when others then e := sqlstate; end;
  reset role;
  insert into _t values (3, 'anon: permission denied', e = '42501', e);
end $$;
insert into _t select 4, 'grants: authenticated yes, anon/public no; internals closed',
  has_function_privilege('authenticated', 'restore_positive_junk_leads(jsonb,text,boolean,boolean)', 'execute')
  and not has_function_privilege('anon', 'restore_positive_junk_leads(jsonb,text,boolean,boolean)', 'execute')
  and not has_function_privilege('authenticated', 'positive_junk_rows(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'restore_sibling_block(uuid,uuid)', 'execute')
  and (select not (coalesce(proacl::text, '') ~ '(\{|,)=X') from pg_proc where proname = 'restore_positive_junk_leads'), null;

-- ---------------- admin: list and input checks
select pg_temp.as_user(admin_auth) from _c;
create temp table _tm on commit drop as select clock_timestamp() t0;
create temp table _l on commit drop as select get_positive_junk_leads() j;
insert into _t select 5, 'admin list: positive-history junk leads, 015f262e = CONVERTED -> CONVERTED / FOLLOW_UP',
  jsonb_array_length(j->'rows') >= 90
  and exists (select 1 from jsonb_array_elements(j->'rows') r where r->>'lead_id8' = '015f262e' and r->>'highest_positive' = 'CONVERTED'
              and r->>'restore_status' = 'CONVERTED' and r->>'restore_stage' = 'FOLLOW_UP' and r->>'junked_by' = 'SYSTEM'),
  format('%s rows, %s ms', jsonb_array_length(j->'rows'), (extract(epoch from clock_timestamp() - (select t0 from _tm)) * 1000)::int) from _l;
do $$ begin
  perform restore_positive_junk_leads((select jsonb_agg(jsonb_build_object('lead_id', (select x from _c), 'employee_id', (select muskan from _c))) from generate_series(1, 26)), 'test reason');
  insert into _t values (6, 'more than 25 refused', false, 'ran');
exception when others then insert into _t values (6, 'more than 25 refused', sqlerrm like '%at most 25%', left(sqlerrm, 60)); end $$;
do $$ begin
  perform restore_positive_junk_leads(pg_temp.items((select x from _c), (select muskan from _c)), '  ');
  insert into _t values (7, 'reason is mandatory', false, 'ran');
exception when others then insert into _t values (7, 'reason is mandatory', sqlerrm like '%reason%required%', left(sqlerrm, 60)); end $$;
insert into _t select 8, 'inactive employee refused, lead stays JUNK',
  r->0->>'result' = 'REFUSED' and r->0->>'why' like '%not an active%' and (select status from leads where id = (select x from _c)) = 'JUNK', r->0->>'why'
  from (select restore_positive_junk_leads(pg_temp.items(x, sonendra), 'test reason') r from _c) z;
insert into _t select 9, 'preview (dry run) writes nothing',
  r->0->>'result' = 'WOULD_RESTORE' and (select status from leads where id = (select x from _c)) = 'JUNK'
  and not exists (select 1 from lead_restore_log where lead_id = (select x from _c)), r->0->>'result'
  from (select restore_positive_junk_leads(pg_temp.items(x, muskan), 'test reason', false, true) r from _c) z;

-- ---------------- sibling hold: a positive LEAD copy of y's number with Kashish
insert into leads (name, mobile, project, status, lead_type, current_owner_id, board_stage)
select 'TEST sibling', l.mobile, 'TEST sibling project', 'CONNECTED', 'LEAD', c.kashish, 'LEADS' from leads l, _c c where l.id = c.y;
-- (results are stored first: rows a function writes are not visible to the same statement's snapshot)
create temp table _h on commit drop as select restore_positive_junk_leads(pg_temp.items(y, muskan), 'test reason') r from _c;
insert into _t select 10, 'positive copy with another employee -> HELD, lead untouched, event logged',
  r->0->>'result' = 'HELD' and (select status from leads where id = (select y from _c)) = 'JUNK'
  and exists (select 1 from lead_guard_events g where g.lead_id = (select y from _c) and g.action = 'ADMIN_RESTORE_HELD'), r->0->>'result' from _h;
create temp table _b on commit drop as select restore_positive_junk_leads(pg_temp.items(y, muskan), 'test reason', true) r from _c;
insert into _t select 11, 'admin bypass after extra confirm -> RESTORED, bypass recorded',
  r->0->>'result' = 'RESTORED' and (r->0->>'sibling_bypassed')::boolean
  and (select sibling_bypassed from lead_restore_log where lead_id = (select y from _c)), r->0->>'result' from _b;

-- ---------------- DATA copy of x: listed as a copy, never restored, untouched by x's restore
insert into leads (name, mobile, project, status, lead_type, current_owner_id, board_stage)
select 'TEST data copy', l.mobile, 'TEST data project', 'JUNK', 'DATA', c.kashish, 'LEADS' from leads l, _c c where l.id = c.x;
create temp table _d on commit drop as select id, md5(row(l.*)::text) h from leads l where name = 'TEST data copy' and project = 'TEST data project';
insert into lead_history (lead_id, employee_id, assigned_at, is_active, call_count, assigned_by_type, outcome, outcome_at, ended_reason)
select d.id, c.kashish, now() - interval '20 days', false, 1, 'SYSTEM', 'CONNECTED', now() - interval '19 days', 'JUNK' from _d d, _c c;

-- ---------------- real restore of x to Muskan
create temp table _r on commit drop as select restore_positive_junk_leads(pg_temp.items(x, muskan), 'Customer was converted; restore test') r from _c;
insert into _t select 12, 'x restored: CONVERTED / FOLLOW_UP, owner Muskan, recycle count 0',
  r->0->>'result' = 'RESTORED' and l.status = 'CONVERTED' and l.board_stage = 'FOLLOW_UP' and l.current_owner_id = c.muskan and l.recycle_count = 0
  and l.last_unjunked_at = now() and l.sla_deadline is null, l.status || '/' || l.board_stage from _r, leads l, _c c where l.id = c.x;
insert into _t select 13, 'new active assignment (ADMIN, fresh activity time)',
  count(*) = 1 and bool_and(h.assigned_by_type = 'ADMIN' and h.last_activity_at = now() and h.reassign_note like 'Restored by admin:%'), count(*)::text
  from lead_history h, _c c where h.lead_id = c.x and h.is_active;
insert into _t select 14, 'logs: activity "Restored by admin", guard event with previous state, undo row',
  exists (select 1 from lead_activity_log a where a.lead_id = c.x and a.activity_type = 'ADMIN_RESTORE' and a.detail = 'Restored by admin: Customer was converted; restore test')
  and exists (select 1 from lead_guard_events g where g.lead_id = c.x and g.action = 'ADMIN_RESTORE' and g.detail->'prev_state'->>'status' = 'JUNK')
  and exists (select 1 from lead_restore_log r where r.lead_id = c.x and r.prev_state->>'status' = 'JUNK' and r.prev_state->>'recycle_count' = '3'
              and r.protected_until between now() + interval '13 days 23 hours' and now() + interval '14 days 1 hour'), null from _c c;
insert into _t select 15, 'employee notified: "A lead you worked on was given back to you"',
  exists (select 1 from notification n where n.employee_id = c.muskan and n.type = 'LEAD_RESTORED' and n.related_lead_id = c.x
          and n.title = 'A lead you worked on was given back to you'), null from _c c;
insert into _t select 16, 'DATA copy untouched by the restore and listed as a copy',
  (select md5(row(l.*)::text) from leads l where l.id = d.id) = d.h and (select is_data_copy from positive_junk_rows(d.id)), null from _d d;
insert into _t select 17, 'DATA copy itself is never restored',
  r->0->>'result' = 'REFUSED' and r->0->>'why' like 'DATA copy%' and (select md5(row(l.*)::text) from leads l where l.id = d.id) = d.h, r->0->>'why'
  from _d d, lateral (select restore_positive_junk_leads(pg_temp.items(d.id, (select muskan from _c)), 'test reason') r) z;
insert into _t select 18, 'restoring again is refused (not junk any more)',
  r->0->>'result' = 'REFUSED' and r->0->>'why' like 'lead is not junk%', r->0->>'why'
  from (select restore_positive_junk_leads(pg_temp.items(x, muskan), 'test reason') r from _c) z;

-- ---------------- protection
update leads set status = 'NOT_CONNECTED', board_stage = 'LEADS' where id = (select x from _c);   -- even after a non-positive result
insert into _t select 19, 'protected: auto-junk guard refuses inside the window',
  auto_junk_window_check(c.x, h.id) like 'restored by an admin, protected until%', auto_junk_window_check(c.x, h.id)
  from _c c join lead_history h on h.lead_id = c.x and h.is_active;
select pg_temp.as_user(null);
select mark_lead_junk_atomic(c.x, h.id, 'max recycles reached') from _c c join lead_history h on h.lead_id = c.x and h.is_active;
insert into _t select 20, 'sweep junk call is refused while protected', status = 'NOT_CONNECTED', status from leads where id = (select x from _c);
update lead_restore_log set protected_until = now() - interval '1 second' where lead_id = (select x from _c);
insert into _t select 21, 'after the window the normal rules apply again',
  coalesce(auto_junk_window_check(c.x, h.id), 'junkable') not like 'restored by an admin%', coalesce(auto_junk_window_check(c.x, h.id), 'junkable')
  from _c c join lead_history h on h.lead_id = c.x and h.is_active;
