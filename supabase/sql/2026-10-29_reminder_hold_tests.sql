-- Known-answer tests for 2026-10-29_reminder_hold.sql. Run ONLY inside a transaction that is never committed:
--   begin; <apply file without its begin/commit>; <this file>; do $$ begin raise exception 'DRYRUN_RESULT %', ...; end $$;
-- One real active LEAD assignment is reshaped inside the transaction (status, dates, notes) so the junk guard sees a
-- plain "inactive for 10 days, 3rd recycle" lead; nothing survives the rollback.
create temp table _t (n int, name text, pass boolean, info text) on commit drop;
create temp table _c on commit drop as
select h.lead_id lead, h.id hist, h.employee_id emp
from lead_history h
join leads l on l.id = h.lead_id and coalesce(l.lead_type, 'LEAD') = 'LEAD' and not coalesce(l.is_personal_lead, false) and l.merged_into_lead_id is null
join employees e on e.id = h.employee_id and e.is_active
where h.is_active
  and not exists (select 1 from lead_history x where x.lead_id = h.lead_id and x.outcome = 'NOT_INTERESTED')
  and not exists (select 1 from lead_restore_log r where r.lead_id = h.lead_id)
  and not exists (select 1 from employee_leave_periods p where p.employee_id = h.employee_id and p.start_date <= current_date + 1 and (p.end_date is null or p.end_date >= current_date - 1))
order by h.assigned_at
limit 1;
update leads set status = 'NOT_CONNECTED', board_stage = 'LEADS', recycle_count = 3, last_unjunked_at = null where id = (select lead from _c);
update lead_history set assigned_at = now() - interval '20 days', last_activity_at = now() - interval '10 days', outcome = 'NOT_CONNECTED',
       outcome_at = now() - interval '10 days', paused_until = null, pause_reason = null where id = (select hist from _c);
delete from lead_notes where lead_history_id = (select hist from _c);
create or replace function pg_temp.remind(p interval) returns void language sql as $$
  delete from lead_notes where lead_history_id = (select hist from _c);
  insert into lead_notes (lead_id, lead_history_id, employee_id, note, reminder_at) select lead, hist, emp, 'TEST reminder', now() + p from _c;
$$;
create or replace function pg_temp.reset_lead() returns void language sql as $$
  update leads set status = 'NOT_CONNECTED' where id = (select lead from _c);
  update lead_history set is_active = true, ended_reason = null where id = (select hist from _c);
$$;
create or replace function pg_temp.junk() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform mark_lead_junk_atomic((select lead from _c), (select hist from _c), 'max recycles reached');
end $$;

insert into _t select 0, 'fixture found, default mode shadow / 30 days', count(*) = 1
  and (select reminder_hold_mode = 'shadow' and reminder_hold_max_days = 30 from lead_engine_settings where id = 1), null from _c;
insert into _t select 1, 'no reminder: junkable as before, no hold',
  auto_junk_window_check(lead, hist) is null and reminder_hold_until(hist) is null, coalesce(auto_junk_window_check(lead, hist), 'null') from _c;

select pg_temp.remind(interval '5 days');
insert into _t select 2, 'reminder in 5 days: hold until about 11 days from now',
  reminder_hold_until(hist) > now() + interval '10 days', to_char(reminder_hold_until(hist) - now(), 'DD "d" HH24 "h"') from _c;
insert into _t select 3, 'shadow: junk guard unchanged (still junkable)', auto_junk_window_check(lead, hist) is null, null from _c;
select pg_temp.junk();
insert into _t select 4, 'shadow: lead junked exactly as before, "REMINDER_HOLD would skip" logged',
  (select status from leads where id = c.lead) = 'JUNK'
  and exists (select 1 from lead_guard_events g where g.lead_id = c.lead and g.source = 'db_reminder_hold' and g.action = 'REMINDER_HOLD'
              and g.mode = 'shadow' and g.detail->>'message' = 'REMINDER_HOLD would skip'), null from _c c;
select pg_temp.reset_lead();

update lead_engine_settings set reminder_hold_mode = 'enforce' where id = 1;
insert into _t select 5, 'enforce: guard refuses with the hold reason', auto_junk_window_check(lead, hist) like 'owner follow-up reminder pending, hold until%',
  auto_junk_window_check(lead, hist) from _c;
select pg_temp.junk();
insert into _t select 6, 'enforce: sweep junk call refused, lead stays, refusal logged',
  (select status from leads where id = c.lead) = 'NOT_CONNECTED'
  and exists (select 1 from lead_guard_events g where g.lead_id = c.lead and g.source = 'db_auto_junk_guard' and g.action = 'JUNK_REFUSED'), null from _c c;

update lead_history set last_activity_at = now() - interval '40 days' where id = (select hist from _c);
select pg_temp.remind(interval '60 days');
insert into _t select 7, 'cap: reminder 60 days ahead holds only 30 days past last activity (40 days ago) -> no hold',
  reminder_hold_until(hist) is null and auto_junk_window_check(lead, hist) is null, coalesce(auto_junk_window_check(lead, hist), 'null') from _c;

update lead_history set last_activity_at = now() - interval '10 days' where id = (select hist from _c);
select pg_temp.remind(interval '-1 day');
insert into _t select 8, 'past reminder (yesterday): 6-day window counts from the reminder -> held',
  reminder_hold_until(hist) > now() + interval '4 days' and auto_junk_window_check(lead, hist) like 'owner follow-up reminder pending%', null from _c;

select pg_temp.remind(interval '5 days');
insert into lead_history (lead_id, employee_id, assigned_at, is_active, call_count, assigned_by_type, outcome, outcome_at, ended_reason, reassign_note)
select lead, emp, now() - interval '60 days' + make_interval(days => g), false, 1, 'SYSTEM', 'NOT_INTERESTED', now() - interval '59 days' + make_interval(days => g), 'ADMIN_REASSIGNED', 'TEST reminder hold'
from _c, generate_series(0, 1) g;
insert into _t select 9, 'repeat Not interested is never held (owner''s own result)',
  reminder_hold_block(lead, hist) is null and auto_junk_window_check(lead, hist) is null, coalesce(auto_junk_window_check(lead, hist), 'null') from _c;
delete from lead_history where lead_id = (select lead from _c) and reassign_note = 'TEST reminder hold';

update lead_engine_settings set reminder_hold_mode = 'off' where id = 1;
create temp table _n on commit drop as select count(*) n from lead_guard_events where source = 'db_reminder_hold';
select pg_temp.junk();
insert into _t select 10, 'off: no hold, no log, junked as before',
  (select status from leads where id = (select lead from _c)) = 'JUNK'
  and (select count(*) from lead_guard_events where source = 'db_reminder_hold') = (select n from _n), null;
select pg_temp.reset_lead();

do $$ begin
  update lead_engine_settings set reminder_hold_mode = 'sometimes' where id = 1;
  insert into _t values (11, 'settings check rejects a bad mode', false, 'accepted');
exception when others then insert into _t values (11, 'settings check rejects a bad mode', sqlerrm like '%reminder_hold_check%', left(sqlerrm, 60)); end $$;
do $$ begin
  update lead_engine_settings set reminder_hold_max_days = 0 where id = 1;
  insert into _t values (12, 'settings check rejects 0 days', false, 'accepted');
exception when others then insert into _t values (12, 'settings check rejects 0 days', sqlerrm like '%reminder_hold_check%', left(sqlerrm, 60)); end $$;
insert into _t select 13, 'helpers closed to the API roles',
  not has_function_privilege('authenticated', 'reminder_hold_until(uuid)', 'execute') and not has_function_privilege('anon', 'reminder_hold_until(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'reminder_hold_block(uuid,uuid)', 'execute'), null;
insert into _t select 14, 'restore protection still answers first',
  auto_junk_window_check(h.lead_id, h.id) like 'restored by an admin%', auto_junk_window_check(h.lead_id, h.id)
  from lead_history h where h.is_active and h.lead_id = (select id from leads where left(id::text, 8) = '015f262e');
