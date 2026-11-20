-- ROLLBACK for the reassign above. Not applied. DO NOT RUN unless undoing. Recorded 2026-11-20 from the 2026-11-13 prep branch; SQL unchanged.
-- ROLLBACK for 2026-11-14_reassign_4287c51b.sql: lead 4287c51b back to Tanu on her previous assignment row (from the
-- prev_state the reassign saved in lead_guard_events), protection window ended. Only this lead, only if Rashmi's
-- assignment is still the active one. Activity, notification and guard-event rows stay as audit history.
begin;

create temp table _undo on commit drop as
select e.lead_id, (e.detail->>'new_history_id')::uuid new_hist, (e.detail->>'restore_log_id')::uuid log_id,
       (e.detail->'prev_state'->>'prev_history_id')::uuid old_hist, (e.detail->'prev_state'->>'current_owner_id')::uuid old_owner,
       (e.detail->'prev_state'->>'sla_deadline')::timestamptz old_sla, e.detail->'prev_state'->>'prev_reassign_note' old_note,
       e.detail->'prev_state'->>'prev_ended_reason' old_ended, e.detail->>'reason' reason, e.created_at
from lead_guard_events e
where e.source = 'admin_reassign' and e.action = 'ADMIN_REASSIGN' and e.lead_id = '4287c51b-dc78-443e-b318-a089b1b20115'
  and e.created_at >= '2026-11-14 00:00:00+05:30'
  and exists (select 1 from lead_history h where h.id = (e.detail->>'new_history_id')::uuid and h.is_active)
  and exists (select 1 from leads l where l.id = e.lead_id and l.current_owner_id = '16f3aeb4-cd2d-4841-b90b-eb47abf6cca9');

do $$ begin
  if (select count(*) from _undo) <> 1 then raise exception 'ABORT: expected exactly 1 reassign to undo, found %', (select count(*) from _undo); end if;
end $$;

update lead_history h set is_active = false, ended_reason = 'ADMIN_REASSIGNED', reassign_note = 'Undo of: ' || u.reason from _undo u where h.id = u.new_hist;
update lead_history h set is_active = true, ended_reason = u.old_ended, reassign_note = u.old_note from _undo u where h.id = u.old_hist;
update leads l set current_owner_id = u.old_owner, sla_deadline = u.old_sla from _undo u where l.id = u.lead_id;
update lead_restore_log r set undone_at = now(), undone_note = 'reassign undone' from _undo u where r.id = u.log_id;
delete from lead_forced_removals f using _undo u
 where f.lead_id = u.lead_id and f.removed_employee_id = u.old_owner and f.reason = u.reason and f.created_at = u.created_at;

do $$ begin
  if (select current_owner_id from leads where id = '4287c51b-dc78-443e-b318-a089b1b20115') <> '27c38b3a-a104-42a0-8d8a-2033c03059ae' then raise exception 'ABORT: rollback did not put the lead back with Tanu'; end if;
end $$;

commit;
