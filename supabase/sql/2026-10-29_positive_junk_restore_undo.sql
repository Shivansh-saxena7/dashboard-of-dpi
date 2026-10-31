-- Undo individual restores done by restore_positive_junk_leads (2026-10-29). Run only after the owner's "haan",
-- first as BEGIN … ROLLBACK, then for real. Put the lead_restore_log ids to undo into v_ids below.
--
-- For each restore that is not undone yet: if the lead is still with the employee it was given to and that
-- assignment is still active, the lead goes back exactly to its saved previous state (prev_state: status,
-- board stage, owner, recycle count, last_unjunked_at, sla_deadline), the restore assignment is closed with
-- ended_reason ADMIN_REASSIGNED (note says "restore undone"), and the log row is marked undone. If the lead moved on since (new owner,
-- new assignment), it is skipped and reported — never forced back.
begin;
do $$
declare
  v_ids uuid[] := array[]::uuid[];   -- <- lead_restore_log.id values
  r record;
  n_done int := 0;
  n_skip int := 0;
begin
  for r in select * from lead_restore_log where id = any(v_ids) and undone_at is null for update loop
    if exists (select 1 from leads l where l.id = r.lead_id and l.current_owner_id = r.to_employee_id)
       and exists (select 1 from lead_history h where h.id = r.new_lead_history_id and h.is_active) then
      -- ended_reason has a fixed list (lead_history_ended_reason_check); the undo is recorded in the note
      update lead_history set is_active = false, ended_reason = 'ADMIN_REASSIGNED',
             reassign_note = coalesce(reassign_note, '') || ' | restore undone ' || to_char(now() at time zone 'Asia/Kolkata', 'DD Mon HH24:MI')
      where id = r.new_lead_history_id;
      update leads set
        status = r.prev_state->>'status',
        board_stage = r.prev_state->>'board_stage',
        board_stage_changed_at = (r.prev_state->>'board_stage_changed_at')::timestamptz,
        current_owner_id = (r.prev_state->>'current_owner_id')::uuid,
        recycle_count = (r.prev_state->>'recycle_count')::int,
        last_unjunked_at = (r.prev_state->>'last_unjunked_at')::timestamptz,
        sla_deadline = (r.prev_state->>'sla_deadline')::timestamptz
      where id = r.lead_id;
      update lead_restore_log set undone_at = now(), undone_note = 'undone by SQL' where id = r.id;
      insert into lead_guard_events (source, action, lead_id, lead_owner_id, project, mode, detail)
      select 'admin_restore', 'ADMIN_RESTORE_UNDONE', r.lead_id, r.to_employee_id, l.project, 'enforce',
             jsonb_build_object('restore_log_id', r.id, 'back_to', r.prev_state)
      from leads l where l.id = r.lead_id;
      n_done := n_done + 1;
    else
      raise notice 'skipped %: the lead changed after the restore', left(r.lead_id::text, 8);
      n_skip := n_skip + 1;
    end if;
  end loop;
  raise notice 'undone %, skipped %', n_done, n_skip;
end $$;
commit;
