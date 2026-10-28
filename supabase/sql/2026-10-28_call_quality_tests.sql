-- Known-answer tests for 2026-10-28_call_quality.sql. Run ONLY inside a transaction that is never committed:
--   begin; <apply file without its begin/commit>; <this file>;
--   do $$ begin raise exception 'DRYRUN_RESULT %', (select json_agg(t order by n) from _t t); end $$;
-- (the raise both reports the results and rolls everything back). 2026-10-28 dry-run: 35/35 PASS.
-- Fixtures are synthetic rows on real ids at dates no real data uses (Jan 2026 / Jan 2030).
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
select a.employee_id emp, a.auth_user_id auth_id, a.lh lh1, a.lead_id lead1, b.lh lh2, b.lead_id lead2, c.lead_id lead3,
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

insert into _t select 0, 'fixture employee found', count(*) = 1, null from _ctx;

-- ---------------- click / link
select pg_temp.as_user(auth_id) from _ctx;
create temp table _c on commit drop as
select call_count cc0, null::uuid click1 from lead_history where id = (select lh1 from _ctx);
update _c set click1 = log_call_click_atomic((select lh1 from _ctx));
insert into _t select 1, 'click returns its new id', exists (select 1 from contact_click_log k where k.id = _c.click1 and k.click_type = 'CALL'), null from _c;
insert into _t select 2, 'call_count +1 exactly as before', (select call_count from lead_history where id = (select lh1 from _ctx)) = cc0 + 1, null from _c;
insert into _t select 3, 'cooldown tap returns the same click, no new row',
  log_call_click_atomic((select lh1 from _ctx)) = click1
  and (select count(*) from contact_click_log k where k.lead_history_id = (select lh1 from _ctx) and k.clicked_at = now()) = 1, null from _c;
select log_lead_update_atomic(lead1, lh1, 'NOT_CONNECTED', null) from _ctx;
insert into _t select 4, 'outcome linked to the click (server time, gap 0)',
  k.outcome = 'NOT_CONNECTED' and k.outcome_activity_id is not null and k.gap_seconds = 0 and k.outcome_at = now(),
  k.outcome || ' gap=' || k.gap_seconds from contact_click_log k join _c on k.id = _c.click1;
insert into _t select 5, 'status update did not change call_count', (select call_count from lead_history where id = (select lh1 from _ctx)) = cc0 + 1, null from _c;
insert into _t select 6, 'view: QUICK_OUTCOME, not estimated, not orphan',
  'QUICK_OUTCOME' = any(q.flags) and not q.is_estimated and not ('ORPHAN_CLICK' = any(q.flags)), array_to_string(q.flags, ',')
  from call_quality_clicks q join _c on q.click_id = _c.click1;
select log_lead_update_atomic(lead1, lh1, 'SWITCHED_OFF', null) from _ctx;
insert into _t select 7, 'second outcome does not re-link the same click',
  (select outcome from contact_click_log where id = _c.click1) = 'NOT_CONNECTED', null from _c;

-- ---------------- synthetic history (Mon 5 Jan 2026, before go-live -> estimated)
insert into contact_click_log (id, lead_id, lead_history_id, employee_id, click_type, clicked_at)
select gen_random_uuid(), x.lead, x.lh, c.emp, 'CALL', pg_temp.ist(x.t)
from _ctx c, lateral (values
  (c.lead2, c.lh2, '2026-01-05 12:00:00'),   -- A: orphan
  (c.lead3, c.lh1, '2026-01-05 13:00:00'),   -- B1: redial (B2 within 30 min, nothing done)
  (c.lead3, c.lh1, '2026-01-05 13:02:00'),   -- B2: orphan
  (c.lead2, c.lh2, '2026-01-05 20:00:00')    -- C: outside office hours
) x(lead, lh, t);
insert into lead_activity_log (lead_id, lead_history_id, employee_id, activity_type, detail, created_at)
select lead2, lh2, emp, 'STATUS_UPDATE', 'CONNECTED', pg_temp.ist('2026-01-05 20:03:00') from _ctx;  -- C answered after 3 min
insert into _t select 8, 'A orphan + estimated + no shift start',
  'ORPHAN_CLICK' = any(flags) and 'NO_SHIFT_START' = any(flags) and is_estimated, array_to_string(flags, ',')
  from call_quality_clicks where employee_id = (select emp from _ctx) and clicked_at = pg_temp.ist('2026-01-05 12:00:00');
insert into _t select 9, 'B1 redial (neutral), B2 orphan',
  bool_and(case when clicked_at = pg_temp.ist('2026-01-05 13:00:00') then is_redial and not ('ORPHAN_CLICK' = any(flags))
                else 'ORPHAN_CLICK' = any(flags) end), string_agg(array_to_string(flags, ','), ' | ' order by clicked_at)
  from call_quality_clicks where employee_id = (select emp from _ctx) and clicked_at in (pg_temp.ist('2026-01-05 13:00:00'), pg_temp.ist('2026-01-05 13:02:00'));
insert into _t select 10, 'C outside hours, estimated outcome CONNECTED gap 180s, not quick',
  'OUTSIDE_OFFICE_HOURS' = any(flags) and outcome = 'CONNECTED' and gap_seconds = 180 and not ('QUICK_OUTCOME' = any(flags)) and not ('ORPHAN_CLICK' = any(flags)),
  array_to_string(flags, ',') || ' gap=' || gap_seconds
  from call_quality_clicks where employee_id = (select emp from _ctx) and clicked_at = pg_temp.ist('2026-01-05 20:00:00');

-- outcome without a click (Tue 6 Jan) and the WhatsApp exemption
insert into lead_activity_log (lead_id, lead_history_id, employee_id, activity_type, detail, created_at)
select lead2, lh2, emp, 'STATUS_UPDATE', 'NOT_CONNECTED', pg_temp.ist('2026-01-06 12:00:00') from _ctx
union all select lead3, lh1, emp, 'STATUS_UPDATE', 'CONNECTED', pg_temp.ist('2026-01-06 15:00:00') from _ctx;
insert into contact_click_log (lead_id, lead_history_id, employee_id, click_type, clicked_at)
select lead3, lh1, emp, 'WHATSAPP', pg_temp.ist('2026-01-06 14:59:00') from _ctx;
insert into _t select 11, 'OUTCOME_NO_CLICK flagged once (WhatsApp outcome not flagged)', count(*) = 1, count(*)::text
  from call_quality_flags where employee_id = (select emp from _ctx) and flag = 'OUTCOME_NO_CLICK'
   and event_at >= pg_temp.ist('2026-01-06 00:00:00') and event_at < pg_temp.ist('2026-01-07 00:00:00');

-- rapid / burst / repeat (Mon 7 Jan 2030, future -> pending, so never orphan)
insert into contact_click_log (lead_id, lead_history_id, employee_id, click_type, clicked_at)
select case when g <= 4 then c.lead2 else c.lead3 end, c.lh2, c.emp, 'CALL', pg_temp.ist('2030-01-07 12:00:00') + make_interval(secs => g * 10)
from _ctx c, generate_series(0, 9) g;
insert into _t select 12, 'rapid 9, burst 3 (8th..10th), repeat 4 (4th+5th on each of 2 leads), pending, no orphan',
  count(*) filter (where 'RAPID_CLICK' = any(flags)) = 9 and count(*) filter (where 'BURST' = any(flags)) = 3
  and count(*) filter (where 'REPEAT_CLICKS' = any(flags)) = 4 and bool_and(is_pending) and count(*) filter (where 'ORPHAN_CLICK' = any(flags)) = 0,
  format('rapid=%s burst=%s repeat=%s', count(*) filter (where 'RAPID_CLICK' = any(flags)), count(*) filter (where 'BURST' = any(flags)), count(*) filter (where 'REPEAT_CLICKS' = any(flags)))
  from call_quality_clicks where employee_id = (select emp from _ctx) and work_date = '2030-01-07';

-- daily numbers + score
insert into _t select 13, 'daily: 4 clicks, judged 3, clean 1, 2 outcomes, 1 no-click, score null (sample < 10)',
  sum(dial_clicks) = 4 and sum(judged) = 3 and sum(clean) = 1 and sum(logged_calls) = 3 and sum(outcome_no_click) = 1
  and call_quality_score(sum(clean)::bigint, sum(judged)::bigint, sum(outcome_no_click)::bigint, 10) is null,
  format('clicks=%s judged=%s clean=%s logged=%s noclick=%s', sum(dial_clicks), sum(judged), sum(clean), sum(logged_calls), sum(outcome_no_click))
  from call_quality_daily((select emp from _ctx), '2026-01-05', '2026-01-06');
insert into _t select 14, 'score formula 7/(8+2)=70, min sample respected',
  call_quality_score(7, 8, 2, 10) = 70 and call_quality_score(7, 8, 1, 10) is null, null;

-- ---------------- access rules (as the employee)
insert into _t select 15, 'employee: own summary allowed', jsonb_typeof(get_call_quality_summary(emp, '2026-01-05', '2026-01-06')->'employees') = 'array', null from _ctx;
do $$ begin
  perform get_call_quality_summary(null, '2026-01-05', '2026-01-06');
  insert into _t values (16, 'employee: team summary refused', false, 'no error');
exception when others then insert into _t values (16, 'employee: team summary refused', sqlerrm like '%not authorized%', sqlerrm); end $$;
do $$ begin
  perform get_call_quality_details((select employee_id from lead_history where employee_id <> (select emp from _ctx) limit 1), '2026-01-05', '2026-01-06');
  insert into _t values (17, 'employee: another employee''s details refused', false, 'no error');
exception when others then insert into _t values (17, 'employee: another employee''s details refused', sqlerrm like '%not authorized%', sqlerrm); end $$;
insert into _t select 18, 'employee: own details list has the 4 Jan-5 clicks + 1 no-click', jsonb_array_length(get_call_quality_details(emp, '2026-01-05', '2026-01-06')) = 5,
  jsonb_array_length(get_call_quality_details(emp, '2026-01-05', '2026-01-06'))::text from _ctx;
create temp table _wr on commit drop as select get_employee_work_report(emp, (now() at time zone 'Asia/Kolkata')::date)::jsonb j from _ctx;
insert into _t select 19, 'work report: all old keys still there',
  j ?& array['calls','callDetails','connected','connectedDetails','notConnected','notConnectedDetails','switchedOff','switchedOffDetails',
             'notInterested','notInterestedDetails','converted','convertedDetails','followUps','followUpDetails','visits','visitDetails',
             'bookings','bookingDetails','stuckLeads','stuckLeadsDetails','personalLeads','personalLeadDetails'], null from _wr;
insert into _t select 20, 'work report: new keys present', j ?& array['dial_clicks','logged_calls','genuine_score','call_quality_flags','call_quality_estimated','call_quality_visible']
  and (j->>'dial_clicks')::int >= 1, format('dial=%s logged=%s score=%s', j->>'dial_clicks', j->>'logged_calls', coalesce(j->>'genuine_score', 'null')) from _wr;
update lead_engine_settings set call_quality_visible_to_employees = false where id = 1;
insert into _t select 21, 'visibility OFF: employee report hides call quality', (get_employee_work_report(emp, (now() at time zone 'Asia/Kolkata')::date)::jsonb->>'call_quality_visible') = 'false'
  and not (get_employee_work_report(emp, (now() at time zone 'Asia/Kolkata')::date)::jsonb ? 'genuine_score'), null from _ctx;
do $$ begin
  perform get_call_quality_summary((select emp from _ctx), '2026-01-05', '2026-01-06');
  insert into _t values (22, 'visibility OFF: own summary refused', false, 'no error');
exception when others then insert into _t values (22, 'visibility OFF: own summary refused', sqlerrm like '%not visible%', sqlerrm); end $$;
update lead_engine_settings set call_quality_visible_to_employees = true where id = 1;
do $$ begin
  perform update_call_quality_settings('{"quick_outcome_seconds": 5}');
  insert into _t values (23, 'employee cannot change settings', false, 'no error');
exception when others then insert into _t values (23, 'employee cannot change settings', sqlerrm like '%admin only%', sqlerrm); end $$;

-- direct table/view access through the API roles (results kept in variables: the API roles cannot write _t)
do $$ declare n int; r24 text; r25 text; r26 text; begin
  set local role authenticated;
  begin select count(*) into n from call_quality_clicks; r24 := 'READ ' || n; exception when others then r24 := sqlerrm; end;
  begin update contact_click_log set gap_seconds = 99; get diagnostics n = row_count; r25 := n || ' rows'; exception when others then r25 := sqlerrm; end;
  reset role;
  set local role anon;
  begin perform get_call_quality_summary(null, current_date, current_date); r26 := 'ran'; exception when others then r26 := sqlerrm; end;
  reset role;
  insert into _t values (24, 'authenticated cannot read the views', r24 like '%permission denied%', r24),
                        (25, 'authenticated cannot edit click rows', r25 = '0 rows' or r25 like '%permission denied%', r25),
                        (26, 'anon cannot run the RPCs', r26 like '%permission denied%', r26);
end $$;

-- ---------------- admin: real 30-day summary, timing
select pg_temp.as_user(admin_auth) from _ctx;
create temp table _tm on commit drop as select clock_timestamp() t0;
create temp table _sum on commit drop as select get_call_quality_summary(null, (now() at time zone 'Asia/Kolkata')::date - 29, (now() at time zone 'Asia/Kolkata')::date) j;
insert into _t select 27, 'admin 30-day summary runs', jsonb_array_length(j->'employees') > 0,
  format('%s employees, %s ms', jsonb_array_length(j->'employees'), (extract(epoch from clock_timestamp() - (select t0 from _tm)) * 1000)::int) from _sum;
update _tm set t0 = clock_timestamp();
insert into _t select 28, 'admin details (busiest employee, 30 days) runs',
  jsonb_array_length(get_call_quality_details((select (e->>'employee_id')::uuid from _sum, jsonb_array_elements(j->'employees') e order by (e->'totals'->>'dial_clicks')::int desc limit 1),
     (now() at time zone 'Asia/Kolkata')::date - 29, (now() at time zone 'Asia/Kolkata')::date)) > 0,
  format('%s ms', (extract(epoch from clock_timestamp() - (select t0 from _tm)) * 1000)::int);
do $$ begin
  perform update_call_quality_settings('{"quick_outcome_seconds": 0}');
  insert into _t values (29, 'settings range check', false, 'accepted 0');
exception when others then insert into _t values (29, 'settings range check', sqlerrm like '%call_quality_ranges%', sqlerrm); end $$;
select update_call_quality_settings('{"quick_outcome_seconds": 12}');
insert into _t select 30, 'admin can change a threshold', quick_outcome_seconds = 12, null from lead_engine_settings where id = 1;

-- ---------------- nudges
update lead_engine_settings set call_quality_live_since = now() - interval '2 hours' where id = 1;
delete from contact_click_log where employee_id = (select emp from _ctx) and clicked_at >= pg_temp.ist('2030-01-01 00:00:00');
insert into contact_click_log (id, lead_id, lead_history_id, employee_id, click_type, clicked_at)
select '00000000-0000-4000-8000-00000000c0de', lead2, lh2, emp, 'CALL', now() - interval '40 minutes' from _ctx;
create temp table _n on commit drop as select send_call_outcome_nudges() sent;
insert into _t select 31, 'nudge sent for a 40-min-old click with no outcome',
  (select outcome_nudged_at is not null from contact_click_log where id = '00000000-0000-4000-8000-00000000c0de')
  and exists (select 1 from notification where employee_id = (select emp from _ctx) and type = 'CALL_OUTCOME_MISSING' and created_at = now()),
  'sent=' || sent from _n;
insert into _t select 32, 'second run sends nothing new', send_call_outcome_nudges() = 0, null;
insert into _t select 33, 'day-end summary runs', send_call_quality_daily_summary() >= 0, null;
insert into _t select 34, 'cron jobs scheduled', count(*) = 2, string_agg(jobname || ' ' || schedule, '; ')
  from cron.job where jobname in ('call-outcome-nudges', 'call-quality-daily-summary');
