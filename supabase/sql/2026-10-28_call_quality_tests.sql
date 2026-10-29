-- Known-answer tests for 2026-10-28_call_quality.sql (rules of 2026-10-29). Run ONLY inside a transaction that is
-- never committed:
--   begin; <apply file without its begin/commit>; <this file>;
--   do $$ begin raise exception 'DRYRUN_RESULT %', (select json_agg(t order by n) from _t t); end $$;
-- (the raise both reports the results and rolls everything back).
-- Fixtures are synthetic rows on real ids at dates no real data uses (January 2026).
create temp table _t (n int, name text, pass boolean, info text) on commit drop;
create temp table _ctx on commit drop as
with cand as (
  select h.employee_id, h.id lh, h.lead_id, e.auth_user_id,
         row_number() over (partition by h.employee_id order by h.assigned_at desc) rn,
         count(*) over (partition by h.employee_id) n
  from lead_history h
  join leads l on l.id = h.lead_id and l.current_owner_id = h.employee_id
  join employees e on e.id = h.employee_id and e.is_active and e.role = 'employee' and e.department = 'sales'
  where h.is_active and not is_lead_terminal(l.status, l.board_stage)
)
select a.employee_id emp, a.auth_user_id auth_id, a.lh lh1, a.lead_id lead1, b.lh lh2, b.lead_id lead2, c.lh lh3, c.lead_id lead3,
       (select coalesce(lead_type, 'LEAD') from leads where id = b.lead_id) type2,
       (select auth_user_id from employees where role = 'admin' and is_active limit 1) admin_auth
from cand a join cand b on b.employee_id = a.employee_id and b.rn = 2 join cand c on c.employee_id = a.employee_id and c.rn = 3
where a.rn = 1 and a.n >= 3
order by a.n desc
limit 1;

create or replace function pg_temp.as_user(p_auth uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_auth::text, true),
         set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true)
$$;
create or replace function pg_temp.ist(p text) returns timestamptz language sql as $$ select (p || '+05:30')::timestamptz $$;
create or replace function pg_temp.clk(p_lead uuid, p_lh uuid, p_at text, p_type text default 'CALL') returns void language sql as $$
  insert into contact_click_log (lead_id, lead_history_id, employee_id, click_type, clicked_at)
  select p_lead, p_lh, emp, p_type, pg_temp.ist(p_at) from _ctx
$$;
create or replace function pg_temp.st(p_lead uuid, p_lh uuid, p_at text, p_status text, p_method text default null) returns void language sql as $$
  insert into lead_activity_log (lead_id, lead_history_id, employee_id, activity_type, detail, contact_method, created_at)
  select p_lead, p_lh, emp, 'STATUS_UPDATE', p_status, p_method, pg_temp.ist(p_at) from _ctx
$$;
create or replace function pg_temp.row_at(p_at text)
returns table (flags text[], score_flags text[], is_estimated boolean, is_redial boolean, gap_seconds integer, result_kind text,
               prev_click_gap_seconds integer, prev_click_had_result boolean) language sql as $$
  select q.flags, q.score_flags, q.is_estimated, q.is_redial, q.gap_seconds, q.result_kind, q.prev_click_gap_seconds, q.prev_click_had_result
  from call_quality_click_rows((select emp from _ctx), pg_temp.ist(p_at), pg_temp.ist(p_at) + interval '1 second') q
$$;

insert into _t select 0, 'fixture employee found', count(*) = 1, null from _ctx;

-- ---------------- click / link / "How did you talk?"
select pg_temp.as_user(auth_id) from _ctx;
create temp table _c on commit drop as
select call_count cc0, null::uuid click1, null::uuid click2 from lead_history where id = (select lh1 from _ctx);
update _c set click1 = log_call_click_atomic((select lh1 from _ctx));
insert into _t select 1, 'click returns its new id', exists (select 1 from contact_click_log k where k.id = _c.click1 and k.click_type = 'CALL'), null from _c;
insert into _t select 2, 'call_count +1 exactly as before', (select call_count from lead_history where id = (select lh1 from _ctx)) = cc0 + 1, null from _c;
insert into _t select 3, 'cooldown tap returns the same click, no new row',
  log_call_click_atomic((select lh1 from _ctx)) = click1
  and (select count(*) from contact_click_log k where k.lead_history_id = (select lh1 from _ctx) and k.clicked_at = now()) = 1, null from _c;
select log_lead_update_atomic(lead1, lh1, 'NOT_CONNECTED', null, null, null, 'CRM_CALL') from _ctx;
insert into _t select 4, 'outcome linked to the click (server time, gap 0), contact method saved',
  k.outcome = 'NOT_CONNECTED' and k.gap_seconds = 0 and k.outcome_at = now() and a.contact_method = 'CRM_CALL' and a.created_at = now(),
  k.outcome || ' gap=' || k.gap_seconds
  from contact_click_log k join _c on k.id = _c.click1 join lead_activity_log a on a.id = k.outcome_activity_id;
insert into _t select 5, 'status update did not change call_count', (select call_count from lead_history where id = (select lh1 from _ctx)) = cc0 + 1, null from _c;
insert into _t select 6, 'NOT_CONNECTED after 0 s: TOO_FAST shown (below 3 s floor) but not scored, not estimated',
  'TOO_FAST' = any(q.flags) and not ('TOO_FAST' = any(q.score_flags)) and not q.is_estimated, array_to_string(q.flags, ',')
  from call_quality_click_rows((select emp from _ctx), now(), now() + interval '1 second') q join _c on q.click_id = _c.click1;
select log_lead_update_atomic(p_lead_id => lead1, p_lead_history_id => lh1, p_new_status => 'SWITCHED_OFF', p_note => null,
                              p_reminder_value => null, p_reminder_unit => null) from _ctx;
insert into _t select 7, 'old 6-argument call still works; does not re-link the same click; method null',
  (select outcome from contact_click_log where id = _c.click1) = 'NOT_CONNECTED'
  and (select contact_method is null from lead_activity_log where employee_id = (select emp from _ctx) and detail = 'SWITCHED_OFF' and created_at = now()), null from _c;
update _c set click2 = log_call_click_atomic((select lh2 from _ctx));
select log_lead_update_atomic(lead2, lh2, 'CONNECTED', null, null, null, null) from _ctx;
insert into _t select 8, 'CONNECTED after 0 s: TOO_FAST and it lowers the score',
  'TOO_FAST' = any(q.score_flags), array_to_string(q.score_flags, ',')
  from call_quality_click_rows((select emp from _ctx), now(), now() + interval '1 second') q join _c on q.click_id = _c.click2;
do $$ begin
  perform log_lead_update_atomic((select lead1 from _ctx), (select lh1 from _ctx), 'NOT_CONNECTED', null, null, null, 'BY_PIGEON');
  insert into _t values (9, 'unknown contact method refused', false, 'accepted');
exception when others then insert into _t values (9, 'unknown contact method refused', sqlerrm like '%not a valid contact method%', left(sqlerrm, 80)); end $$;

-- ---------------- Mon 5 Jan 2026 (before go-live -> estimated). lead2 = L2, lead3 = L3
select pg_temp.clk(lead2, lh2, '2026-01-05 12:00:00') from _ctx;                                           -- A: nothing after
select pg_temp.clk(lead3, lh3, '2026-01-05 13:00:00'), pg_temp.clk(lead3, lh3, '2026-01-05 13:02:00') from _ctx; -- B1 redial, B2 nothing
select pg_temp.clk(lead3, lh3, '2026-01-05 15:00:00'), pg_temp.st(lead3, lh3, '2026-01-05 15:00:08', 'NOT_INTERESTED') from _ctx; -- D: NI 8 s
select pg_temp.clk(lead2, lh2, '2026-01-05 15:30:00'), pg_temp.st(lead2, lh2, '2026-01-05 15:30:20', 'CONNECTED') from _ctx;      -- E: connected 20 s
select pg_temp.clk(lead3, lh3, '2026-01-05 16:00:00') from _ctx;                                           -- F: note after 45 min
insert into lead_notes (lead_id, lead_history_id, employee_id, note, created_at) select lead3, lh3, emp, 'TEST note', pg_temp.ist('2026-01-05 16:45:00') from _ctx;
select pg_temp.clk(lead2, lh2, '2026-01-05 20:00:00'), pg_temp.st(lead2, lh2, '2026-01-05 20:03:00', 'CONNECTED') from _ctx;      -- C: after hours, 3 min

insert into _t select 10, 'A: no result in 60 min -> NO_RESULT (scored), estimated, no shift start',
  'NO_RESULT' = any(score_flags) and 'NO_SHIFT_START' = any(flags) and is_estimated, array_to_string(flags, ',') from pg_temp.row_at('2026-01-05 12:00:00');
insert into _t select 11, 'B1 redial (left out), B2 NO_RESULT',
  (select is_redial and cardinality(score_flags) = 0 from pg_temp.row_at('2026-01-05 13:00:00'))
  and (select 'NO_RESULT' = any(score_flags) from pg_temp.row_at('2026-01-05 13:02:00')), null;
insert into _t select 12, 'D: NOT_INTERESTED after 8 s -> TOO_FAST info only',
  'TOO_FAST' = any(flags) and not ('TOO_FAST' = any(score_flags)) and gap_seconds = 8, array_to_string(flags, ',') from pg_temp.row_at('2026-01-05 15:00:00');
insert into _t select 13, 'E: CONNECTED after 20 s (< 25) -> TOO_FAST scored',
  'TOO_FAST' = any(score_flags) and gap_seconds = 20, array_to_string(score_flags, ',') from pg_temp.row_at('2026-01-05 15:30:00');
insert into _t select 14, 'F: note after 45 min = result (no flag at 30 min any more); 4th dial of L3 = REPEAT_DIALS info',
  result_kind = 'NOTE' and not ('NO_RESULT' = any(flags)) and 'REPEAT_DIALS' = any(flags) and cardinality(score_flags) = 0,
  array_to_string(flags, ',') from pg_temp.row_at('2026-01-05 16:00:00');
insert into _t select 15, 'C: after hours, CONNECTED after 180 s -> OUTSIDE_HOURS info, clean',
  'OUTSIDE_HOURS' = any(flags) and gap_seconds = 180 and cardinality(score_flags) = 0, array_to_string(flags, ',') from pg_temp.row_at('2026-01-05 20:00:00');
insert into _t select 16, 'day 5 Jan: 7 dials, judged 6, clean 3, results 4, outcomes 3',
  sum(dial_clicks) = 7 and sum(judged) = 6 and sum(clean) = 3 and sum(results_saved) = 4 and sum(logged_calls) = 3,
  format('dials=%s judged=%s clean=%s saved=%s logged=%s', sum(dial_clicks), sum(judged), sum(clean), sum(results_saved), sum(logged_calls))
  from call_quality_daily((select emp from _ctx), '2026-01-05', '2026-01-05');
insert into _t select 17, 'score: 3/6 = 50 with min 1; null below 30 dials; bands',
  call_quality_score(3, 6, 0, 7, 1) = 50 and call_quality_score(3, 6, 0, 7, 30) is null
  and call_quality_band(80) = 'Green' and call_quality_band(79) = 'Amber' and call_quality_band(59) = 'Red' and call_quality_band(null) is null, null;

-- ---------------- many dials in a row (Wed 7 Jan): fast tap after a saved result is fine, after an unsaved one is not
select pg_temp.clk(lead2, lh2, '2026-01-07 12:00:00'), pg_temp.st(lead2, lh2, '2026-01-07 12:00:10', 'NOT_CONNECTED') from _ctx;
select pg_temp.clk(lead3, lh3, '2026-01-07 12:00:15') from _ctx;
select pg_temp.clk(lead2, lh2, '2026-01-07 12:00:30') from _ctx;
insert into _t select 18, 'tap 15 s after a tap that had a result -> no flag',
  not ('MANY_DIALS' = any(flags)) and prev_click_gap_seconds = 15 and prev_click_had_result, array_to_string(flags, ',') from pg_temp.row_at('2026-01-07 12:00:15');
insert into _t select 19, 'tap 15 s after a tap with no result -> MANY_DIALS (scored)',
  'MANY_DIALS' = any(score_flags) and not prev_click_had_result, array_to_string(score_flags, ',') from pg_temp.row_at('2026-01-07 12:00:30');

-- burst (Thu 8 Jan): 13 taps 20 s apart, no results -> flagged from the Nth tap (N = 8 LEAD, 12 DATA)
select pg_temp.clk(lead2, lh2, to_char((pg_temp.ist('2026-01-08 12:00:00') + make_interval(secs => g * 20)) at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS'))
from _ctx, generate_series(0, 12) g;
insert into _t select 20, 'burst without results flagged from the Nth tap (LEAD 8 / DATA 12)',
  count(*) filter (where 'MANY_DIALS' = any(flags)) = 13 - (case when (select type2 from _ctx) = 'DATA' then 12 else 8 end) + 1,
  format('type=%s flagged=%s', (select type2 from _ctx), count(*) filter (where 'MANY_DIALS' = any(flags)))
  from call_quality_click_rows((select emp from _ctx), pg_temp.ist('2026-01-08 00:00:00'), pg_temp.ist('2026-01-09 00:00:00'));
-- same burst (Fri 9 Jan) with a result after every tap -> not flagged
select pg_temp.clk(lead2, lh2, to_char(t, 'YYYY-MM-DD HH24:MI:SS')), pg_temp.st(lead2, lh2, to_char(t + interval '5 seconds', 'YYYY-MM-DD HH24:MI:SS'), 'NOT_CONNECTED')
from _ctx, (select (pg_temp.ist('2026-01-09 12:00:00') at time zone 'Asia/Kolkata') + make_interval(secs => g * 20) t from generate_series(0, 12) g) x;
insert into _t select 21, 'same burst with a result after every tap -> no MANY_DIALS',
  count(*) filter (where 'MANY_DIALS' = any(flags)) = 0 and count(*) = 13, count(*) filter (where 'MANY_DIALS' = any(flags))::text
  from call_quality_click_rows((select emp from _ctx), pg_temp.ist('2026-01-09 00:00:00'), pg_temp.ist('2026-01-10 00:00:00'));

-- ---------------- result without a dial: pattern vs info, declared and WhatsApp exempt
-- Mon 12 Jan: 1 of 5 outcomes without a dial = 20% -> pattern, scored
select pg_temp.st(lead2, lh2, '2026-01-12 12:00:00', 'NOT_CONNECTED') from _ctx;
select pg_temp.clk(lead3, lh3, h || ':00:00'), pg_temp.st(lead3, lh3, h || ':01:00', 'NOT_CONNECTED')
from _ctx, (select '2026-01-12 ' || x hh from generate_series(13, 16) x) y(h);
-- Tue 13 Jan: 1 plain + 1 "Called from another phone" + 1 after a WhatsApp tap + 4 with dials -> 1 of 7 = 14% -> info only
select pg_temp.st(lead2, lh2, '2026-01-13 12:00:00', 'NOT_CONNECTED'), pg_temp.st(lead2, lh2, '2026-01-13 12:10:00', 'CONNECTED', 'OTHER_PHONE') from _ctx;
select pg_temp.clk(lead3, lh3, '2026-01-13 12:19:00', 'WHATSAPP'), pg_temp.st(lead3, lh3, '2026-01-13 12:20:00', 'CONNECTED') from _ctx;
select pg_temp.clk(lead3, lh3, h || ':00:00'), pg_temp.st(lead3, lh3, h || ':01:00', 'NOT_CONNECTED')
from _ctx, (select '2026-01-13 ' || x hh from generate_series(13, 16) x) y(h);
insert into _t select 22, '12 Jan: 1 no-dial of 5 outcomes (20%) -> counted in score',
  sum(no_dial) = 1 and sum(no_dial_scored) = 1 and sum(logged_calls) = 5, format('no_dial=%s scored=%s logged=%s', sum(no_dial), sum(no_dial_scored), sum(logged_calls))
  from call_quality_daily((select emp from _ctx), '2026-01-12', '2026-01-12');
insert into _t select 23, '13 Jan: declared other phone + WhatsApp exempt; 1 no-dial of 7 -> info only; declared counted',
  sum(no_dial) = 1 and sum(no_dial_scored) = 0 and sum(declared_other) = 1 and sum(logged_calls) = 7,
  format('no_dial=%s scored=%s declared=%s logged=%s', sum(no_dial), sum(no_dial_scored), sum(declared_other), sum(logged_calls))
  from call_quality_daily((select emp from _ctx), '2026-01-13', '2026-01-13');

-- ---------------- access rules (as the employee)
insert into _t select 24, 'employee: own summary allowed; LEAD/DATA scored separately',
  jsonb_typeof(get_call_quality_summary(emp, '2026-01-05', '2026-01-13')->'employees'->0->'by_card_type'->'LEAD') = 'object', null from _ctx;
do $$ begin
  perform get_call_quality_summary(null, '2026-01-05', '2026-01-06');
  insert into _t values (25, 'employee: team summary refused', false, 'no error');
exception when others then insert into _t values (25, 'employee: team summary refused', sqlerrm like '%not authorized%', left(sqlerrm, 80)); end $$;
do $$ begin
  perform get_call_quality_details((select employee_id from lead_history where employee_id <> (select emp from _ctx) limit 1), '2026-01-05', '2026-01-06');
  insert into _t values (26, 'employee: another employee''s timeline refused', false, 'no error');
exception when others then insert into _t values (26, 'employee: another employee''s timeline refused', sqlerrm like '%not authorized%', left(sqlerrm, 80)); end $$;
insert into _t select 27, 'own timeline 5 Jan: 7 taps, oldest first, with name and settings',
  jsonb_array_length(d->'rows') = 7 and d->'rows'->0->>'clicked_at' < d->'rows'->6->>'clicked_at' and d ? 'employee_name' and d->'settings' ? 'quick_connected_seconds',
  jsonb_array_length(d->'rows')::text
  from (select get_call_quality_details(emp, '2026-01-05', '2026-01-05') d from _ctx) x;
insert into _t select 28, 'timeline 12 Jan: no-dial row is scored (pattern day)',
  exists (select 1 from jsonb_array_elements(d->'rows') r where r->>'kind' = 'NO_DIAL' and r->'score_flags' ? 'NO_DIAL'), null
  from (select get_call_quality_details(emp, '2026-01-12', '2026-01-12') d from _ctx) x;
create temp table _wr on commit drop as select get_employee_work_report(emp, (now() at time zone 'Asia/Kolkata')::date)::jsonb j from _ctx;
insert into _t select 29, 'work report: all old keys still there',
  j ?& array['calls','callDetails','connected','connectedDetails','notConnected','notConnectedDetails','switchedOff','switchedOffDetails',
             'notInterested','notInterestedDetails','converted','convertedDetails','followUps','followUpDetails','visits','visitDetails',
             'bookings','bookingDetails','stuckLeads','stuckLeadsDetails','personalLeads','personalLeadDetails'], null from _wr;
insert into _t select 30, 'work report: new keys present',
  j ?& array['dial_clicks','results_saved','logged_calls','genuine_score','genuine_score_band','genuine_score_card','genuine_score_lead_7d',
             'genuine_score_data_7d','call_quality_flags','call_quality_estimated','call_quality_visible','call_quality_share_line']
  and (j->>'dial_clicks')::int >= 2 and (j->>'call_quality_share_line')::boolean,
  format('dial=%s saved=%s score=%s card=%s', j->>'dial_clicks', j->>'results_saved', coalesce(j->>'genuine_score', 'null'), j->>'genuine_score_card') from _wr;
update lead_engine_settings set call_quality_visible_to_employees = false where id = 1;
insert into _t select 31, 'visibility OFF: employee report hides call quality',
  (get_employee_work_report(emp, (now() at time zone 'Asia/Kolkata')::date)::jsonb->>'call_quality_visible') = 'false'
  and not (get_employee_work_report(emp, (now() at time zone 'Asia/Kolkata')::date)::jsonb ? 'genuine_score'), null from _ctx;
do $$ begin
  perform get_call_quality_summary((select emp from _ctx), '2026-01-05', '2026-01-06');
  insert into _t values (32, 'visibility OFF: own summary refused', false, 'no error');
exception when others then insert into _t values (32, 'visibility OFF: own summary refused', sqlerrm like '%not visible%', left(sqlerrm, 80)); end $$;
update lead_engine_settings set call_quality_visible_to_employees = true where id = 1;
do $$ begin
  perform update_call_quality_settings('{"quick_connected_seconds": 5}');
  insert into _t values (33, 'employee cannot change settings', false, 'no error');
exception when others then insert into _t values (33, 'employee cannot change settings', sqlerrm like '%admin only%', left(sqlerrm, 80)); end $$;

-- direct table/function access through the API roles (results kept in variables: the API roles cannot write _t)
do $$ declare n int; r1 text; r2 text; r3 text; r4 text; begin
  set local role authenticated;
  begin select count(*) into n from call_quality_flags; r1 := 'READ ' || n; exception when others then r1 := sqlerrm; end;
  begin update contact_click_log set gap_seconds = 99; get diagnostics n = row_count; r2 := n || ' rows'; exception when others then r2 := sqlerrm; end;
  begin perform call_quality_click_rows(null, now() - interval '1 day', now()); r3 := 'ran'; exception when others then r3 := sqlerrm; end;
  reset role;
  set local role anon;
  begin perform get_call_quality_summary(null, current_date, current_date); r4 := 'ran'; exception when others then r4 := sqlerrm; end;
  reset role;
  insert into _t values (34, 'authenticated cannot read the views', r1 like '%permission denied%', left(r1, 60)),
                        (35, 'authenticated cannot edit click rows', r2 = '0 rows' or r2 like '%permission denied%', left(r2, 60)),
                        (36, 'authenticated cannot call the internal row function', r3 like '%permission denied%', left(r3, 60)),
                        (37, 'anon cannot run the RPCs', r4 like '%permission denied%', left(r4, 60));
end $$;

-- ---------------- admin: real 30-day summary, timing, settings
select pg_temp.as_user(admin_auth) from _ctx;
create temp table _tm on commit drop as select clock_timestamp() t0;
create temp table _sum on commit drop as select get_call_quality_summary(null, (now() at time zone 'Asia/Kolkata')::date - 29, (now() at time zone 'Asia/Kolkata')::date) j;
insert into _t select 38, 'admin 30-day summary runs', jsonb_array_length(j->'employees') > 0,
  format('%s employees, %s ms', jsonb_array_length(j->'employees'), (extract(epoch from clock_timestamp() - (select t0 from _tm)) * 1000)::int) from _sum;
update _tm set t0 = clock_timestamp();
insert into _t select 39, 'admin timeline (busiest employee, 30 days) runs',
  jsonb_array_length(get_call_quality_details((select (e->>'employee_id')::uuid from _sum, jsonb_array_elements(j->'employees') e order by (e->'totals'->>'dial_clicks')::int desc limit 1),
     (now() at time zone 'Asia/Kolkata')::date - 29, (now() at time zone 'Asia/Kolkata')::date)->'rows') > 0,
  format('%s ms', (extract(epoch from clock_timestamp() - (select t0 from _tm)) * 1000)::int);
do $$ begin
  perform update_call_quality_settings('{"quick_connected_seconds": 0}');
  insert into _t values (40, 'settings range check', false, 'accepted 0');
exception when others then insert into _t values (40, 'settings range check', sqlerrm like '%call_quality_ranges%', left(sqlerrm, 80)); end $$;
do $$ begin
  perform update_call_quality_settings('{"reminder_after_minutes": 90}');
  insert into _t values (41, 'reminder must not be later than the result window', false, 'accepted 90');
exception when others then insert into _t values (41, 'reminder must not be later than the result window', sqlerrm like '%call_quality_ranges%', left(sqlerrm, 80)); end $$;
select update_call_quality_settings('{"quick_connected_seconds": 30, "share_line": false}');
insert into _t select 42, 'admin can change a threshold and the share line', quick_connected_seconds = 30 and not call_quality_share_line, null from lead_engine_settings where id = 1;

-- ---------------- reminders
update lead_engine_settings set call_quality_live_since = now() - interval '2 hours' where id = 1;
delete from contact_click_log where employee_id = (select emp from _ctx) and clicked_at >= pg_temp.ist('2026-01-01 00:00:00') and clicked_at < pg_temp.ist('2026-02-01 00:00:00');
insert into contact_click_log (id, lead_id, lead_history_id, employee_id, click_type, clicked_at)
select '00000000-0000-4000-8000-00000000c0de', lead3, lh3, emp, 'CALL', now() - interval '40 minutes' from _ctx;
create temp table _n on commit drop as select send_call_outcome_nudges() sent;
insert into _t select 43, 'reminder after 30 min for a tap with nothing saved',
  (select outcome_nudged_at is not null from contact_click_log where id = '00000000-0000-4000-8000-00000000c0de')
  and exists (select 1 from notification where employee_id = (select emp from _ctx) and type = 'CALL_OUTCOME_MISSING' and created_at = now()),
  'sent=' || sent from _n;
insert into _t select 44, 'second run sends nothing new', send_call_outcome_nudges() = 0, null;
insert into _t select 45, 'day-end summary runs', send_call_quality_daily_summary() >= 0, null;
insert into _t select 46, 'cron jobs scheduled', count(*) = 2, string_agg(jobname || ' ' || schedule, '; ')
  from cron.job where jobname in ('call-outcome-nudges', 'call-quality-daily-summary');
