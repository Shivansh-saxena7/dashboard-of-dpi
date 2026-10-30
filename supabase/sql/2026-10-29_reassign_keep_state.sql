-- Reassign a lead to another employee WITHOUT resetting it (2026-10-29). APPLIED 2026-10-29 18:00:57 IST (owner's "haan", LF copy, md5 c6966b74); grants: anon/public none, authenticated + service_role.
-- force_reassign_lead_atomic puts every non-terminal lead back to NEW / Leads and drops its pause; this one keeps
-- status, stage, recycle count and the pause, and gives the new owner a fresh clock plus the same protection window
-- the positive-junk restore uses (lead_restore_log.protected_until, read by auto_junk_window_check).
--   * lead_activity_log.activity_type gains 'ADMIN_REASSIGN' (existing values unchanged)
--   * new function reassign_keep_state_atomic(lead, employee, reason) -> jsonb
--       REASSIGNED / ALREADY (already with that employee, nothing written) / HELD (positive copy of the number is with
--       another active employee: sibling guard, nothing moved, guard event logged); anything else raises.
begin;

alter table lead_activity_log drop constraint lead_activity_log_activity_type_check;
alter table lead_activity_log add constraint lead_activity_log_activity_type_check
  check (activity_type = any (array['STATUS_UPDATE'::text, 'BOARD_STAGE_MOVE'::text, 'ADMIN_RESTORE'::text, 'ADMIN_REASSIGN'::text]));

create or replace function public.reassign_keep_state_atomic(p_lead_id uuid, p_new_employee_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_admin uuid := current_employee_id();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_days int := (select restore_protection_days from lead_engine_settings where id = 1);
  v_sla int := (select sla_first_contact_minutes from lead_engine_settings where id = 1);
  v_lead leads%rowtype;
  v_old lead_history%rowtype;
  v_emp employees%rowtype;
  v_block jsonb;
  v_prev jsonb;
  v_top text;
  v_hist uuid;
  v_act uuid;
  v_log uuid;
  v_until timestamptz;
begin
  if not coalesce((select is_admin()), false) or coalesce(current_employee_role(), '') not in ('admin', 'super_admin') or v_admin is null then
    raise exception 'reassign_keep_state_atomic: admin only';
  end if;
  if v_reason is null or length(v_reason) < 5 then
    raise exception 'reassign_keep_state_atomic: a reason (at least 5 characters) is required';
  end if;
  if v_days is null or v_sla is null then
    raise exception 'reassign_keep_state_atomic: lead_engine_settings row not found';
  end if;

  select * into v_emp from employees where id = p_new_employee_id;
  if v_emp.id is null or not v_emp.is_active or coalesce(v_emp.department, '') <> 'sales' then
    raise exception 'reassign_keep_state_atomic: target employee is not an active sales employee';
  end if;

  select * into v_lead from leads where id = p_lead_id for update;
  if v_lead.id is null then
    raise exception 'reassign_keep_state_atomic: lead % not found', p_lead_id;
  end if;
  if v_lead.status = 'JUNK' or v_lead.merged_into_lead_id is not null then
    raise exception 'reassign_keep_state_atomic: lead % is junk or merged (use Restore for junk leads)', left(p_lead_id::text, 8);
  end if;

  select * into v_old from lead_history where lead_id = p_lead_id and is_active for update;
  if v_old.id is null then
    raise exception 'reassign_keep_state_atomic: lead % has no active assignment', left(p_lead_id::text, 8);
  end if;
  if v_old.employee_id = p_new_employee_id then
    return jsonb_build_object('result', 'ALREADY', 'lead_id8', left(p_lead_id::text, 8), 'employee_name', v_emp.name);
  end if;

  v_block := restore_sibling_block(p_lead_id, p_new_employee_id);
  if v_block is not null then
    perform log_guard_event('admin_reassign', 'ADMIN_REASSIGN_HELD', p_lead_id,
      v_block || jsonb_build_object('to_employee_id', p_new_employee_id, 'reason', v_reason));
    return jsonb_build_object('result', 'HELD', 'lead_id8', left(p_lead_id::text, 8), 'employee_name', v_emp.name,
                              'why', 'positive copy of this number is with another employee', 'sibling', v_block);
  end if;

  v_prev := jsonb_build_object('status', v_lead.status, 'board_stage', v_lead.board_stage, 'recycle_count', v_lead.recycle_count,
              'current_owner_id', v_lead.current_owner_id, 'sla_deadline', v_lead.sla_deadline,
              'prev_history_id', v_old.id, 'prev_reassign_note', v_old.reassign_note, 'prev_ended_reason', v_old.ended_reason,
              'paused_until', v_old.paused_until, 'pause_reason', v_old.pause_reason);
  v_top := case when v_lead.board_stage in ('VISIT', 'BOOKING') then v_lead.board_stage
                when v_lead.status in ('CONNECTED', 'CONVERTED') then v_lead.status
                when v_lead.board_stage = 'FOLLOW_UP' then 'FOLLOW_UP'
                else v_lead.status end;
  v_until := now() + make_interval(days => v_days);

  update lead_history set is_active = false, ended_reason = 'ADMIN_REASSIGNED', reassign_note = v_reason
  where id = v_old.id and is_active;

  -- owner and SLA only: status, stage, board_stage_changed_at and recycle_count stay as they are
  update leads set current_owner_id = p_new_employee_id, sla_deadline = compute_working_hours_sla_deadline(now(), v_sla)
  where id = p_lead_id;

  -- fresh clock for the new owner (assigned / last activity = now, no outcome yet), pause carried over unchanged.
  -- The old outcome is not copied: a copied NOT_INTERESTED would count as a second "not interested" for auto-junk.
  insert into lead_history (lead_id, employee_id, assigned_at, is_active, call_count, assigned_by_type, assigned_by_employee_id,
                            reassign_note, last_activity_at,
                            paused_until, pause_reason, pause_note, pause_verified_by, pause_verified_at,
                            pause_expiry_warning_sent_at, pause_expired_notified_at)
  values (p_lead_id, p_new_employee_id, now(), true, 0, 'ADMIN', v_admin,
          v_reason, now(),
          v_old.paused_until, v_old.pause_reason, v_old.pause_note, v_old.pause_verified_by, v_old.pause_verified_at,
          v_old.pause_expiry_warning_sent_at, v_old.pause_expired_notified_at)
  returning id into v_hist;

  insert into lead_forced_removals (lead_id, removed_employee_id, removed_by, reason)
  values (p_lead_id, v_old.employee_id, v_admin, v_reason);

  insert into lead_activity_log (lead_id, lead_history_id, employee_id, activity_type, detail)
  values (p_lead_id, v_hist, v_admin, 'ADMIN_REASSIGN', v_reason)
  returning id into v_act;

  -- same protection row the positive-junk restore writes: auto_junk_window_check skips the lead until protected_until
  insert into lead_restore_log (lead_id, restored_by, to_employee_id, reason, highest_positive, restored_status, restored_stage,
                                protected_until, sibling_bypassed, sibling, prev_state, new_lead_history_id, activity_id)
  values (p_lead_id, v_admin, p_new_employee_id, v_reason, v_top, v_lead.status, coalesce(v_lead.board_stage, 'LEADS'),
          v_until, false, null, v_prev, v_hist, v_act)
  returning id into v_log;

  insert into lead_guard_events (source, action, lead_id, lead_owner_id, project, mode, detail)
  values ('admin_reassign', 'ADMIN_REASSIGN', p_lead_id, p_new_employee_id, v_lead.project, 'enforce',
          jsonb_build_object('reason', v_reason, 'by', v_admin, 'from_employee_id', v_old.employee_id, 'to_employee_id', p_new_employee_id,
                             'new_history_id', v_hist, 'restore_log_id', v_log, 'protected_until', v_until, 'prev_state', v_prev));

  insert into notification (employee_id, employee_name, title, message, type, is_read, related_lead_id)
  values (p_new_employee_id, coalesce(v_emp.name, ''),
          case when v_lead.lead_type = 'DATA' then 'Data Reassigned to You' else 'Lead Reassigned to You' end,
          format('%s has been reassigned to you by an Administrator. Reason: %s', coalesce(v_lead.name, 'A lead'), v_reason),
          case when v_lead.lead_type = 'DATA' then 'DATA_ASSIGNED' else 'LEAD_ASSIGNED' end,
          false, p_lead_id);

  return jsonb_build_object('result', 'REASSIGNED', 'lead_id8', left(p_lead_id::text, 8), 'employee_name', v_emp.name,
                            'status', v_lead.status, 'stage', coalesce(v_lead.board_stage, 'LEADS'), 'protected_until', v_until);
end;
$$;

revoke all on function public.reassign_keep_state_atomic(uuid, uuid, text) from public, anon;
grant execute on function public.reassign_keep_state_atomic(uuid, uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
