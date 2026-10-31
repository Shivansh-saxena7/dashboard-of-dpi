-- Undo for reassign_keep_state_atomic: puts each lead reassigned since @@SINCE@@ back with its previous owner and
-- previous assignment row (from the prev_state saved in lead_guard_events), and ends its protection window.
-- A lead whose assignment changed again after the reassign is skipped and listed (never overwritten).
-- Activity, notification and guard-event rows stay as audit history.
begin;
create temp table _undo as
select e.lead_id, (e.detail->>'new_history_id')::uuid new_hist, (e.detail->>'restore_log_id')::uuid log_id,
       (e.detail->'prev_state'->>'prev_history_id')::uuid old_hist, (e.detail->'prev_state'->>'current_owner_id')::uuid old_owner,
       (e.detail->'prev_state'->>'sla_deadline')::timestamptz old_sla, e.detail->'prev_state'->>'prev_reassign_note' old_note,
       e.detail->'prev_state'->>'prev_ended_reason' old_ended, (e.detail->>'to_employee_id')::uuid new_owner, e.detail->>'reason' reason, e.created_at
from lead_guard_events e
where e.source = 'admin_reassign' and e.action = 'ADMIN_REASSIGN' and e.created_at >= '@@SINCE@@'::timestamptz
  and exists (select 1 from lead_history h where h.id = (e.detail->>'new_history_id')::uuid and h.is_active)
  and exists (select 1 from leads l where l.id = e.lead_id and l.current_owner_id = (e.detail->>'to_employee_id')::uuid);

update lead_history h set is_active = false, ended_reason = 'ADMIN_REASSIGNED', reassign_note = 'Undo of: ' || u.reason
from _undo u where h.id = u.new_hist;
update lead_history h set is_active = true, ended_reason = u.old_ended, reassign_note = u.old_note
from _undo u where h.id = u.old_hist;
update leads l set current_owner_id = u.old_owner, sla_deadline = u.old_sla from _undo u where l.id = u.lead_id;
update lead_restore_log r set undone_at = now(), undone_note = 'reassign undone' from _undo u where r.id = u.log_id;
delete from lead_forced_removals f using _undo u
where f.lead_id = u.lead_id and f.removed_employee_id = u.old_owner and f.reason = u.reason and f.created_at = u.created_at;

select (select count(*) from _undo) undone,
       (select string_agg(left(e.lead_id::text, 8), ', ') from lead_guard_events e
        where e.source = 'admin_reassign' and e.action = 'ADMIN_REASSIGN' and e.created_at >= '@@SINCE@@'::timestamptz
          and e.lead_id not in (select lead_id from _undo)) skipped_changed_since;
commit;
