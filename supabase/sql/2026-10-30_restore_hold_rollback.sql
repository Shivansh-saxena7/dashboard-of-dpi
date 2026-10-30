-- Rollback for 2026-10-30_restore_hold.sql: recycle_lead_atomic back to its live body of 2026-10-30
-- (md5 c2aef74cba7664057ee9c638202f0161), helper and setting removed. Guard events already written stay.
begin;
CREATE OR REPLACE FUNCTION public.recycle_lead_atomic(p_lead_id uuid, p_old_lead_history_id uuid, p_new_employee_id uuid, p_next_pointer_employee_id uuid, p_next_restricted_pool_pointer_employee_id uuid, p_recycle_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lead_name text; v_lead_type text; v_employee_name text;
  v_sla_minutes int; v_deadline timestamptz;
  v_block jsonb;
begin
  if not exists (select 1 from employees where id = p_new_employee_id and is_active = true) then
    raise exception 'recycle_lead_atomic: target employee % is not active', p_new_employee_id;
  end if;

  select lead_type into v_lead_type from leads where id = p_lead_id;
  if v_lead_type is null then
    raise exception 'recycle_lead_atomic: lead % not found', p_lead_id;
  end if;

  -- DB sibling guard (2026-10-18): the sweep (service_role) may not hand this LEAD to a
  -- new owner while the same number is positive with someone else. Refused = nothing is
  -- reassigned; the current assignment is held for 1 day (so the next sweeps skip it and
  -- it never eats the per-sweep recycle cap), one merged anomaly row is written, and the
  -- call returns normally so the sweep carries on.
  if v_lead_type <> 'DATA' and coalesce(auth.role(), '') = 'service_role' then
    v_block := positive_sibling_block(p_lead_id, p_new_employee_id);
    if v_block is not null then
      update lead_history
      set paused_until = now() + interval '1 day',
          pause_reason = 'SIBLING_HOLD',
          pause_expiry_warning_sent_at = now(),
          pause_expired_notified_at = now()
      where id = p_old_lead_history_id and is_active = true;
      perform log_guard_event('db_sibling_guard', 'RECYCLE_REFUSED', p_lead_id,
        v_block || jsonb_build_object('new_owner_id', p_new_employee_id, 'recycle_reason', p_recycle_reason));
      perform log_anomaly('db_sibling_guard', 'warning',
        format('Recycle refused: lead %s would go to another employee while the same number is %s with %s (lead %s); held 1 day',
          left(p_lead_id::text, 8), v_block->>'stage', coalesce(v_block->>'owner_name', '-'), v_block->>'holder_id8'),
        v_block || jsonb_build_object('path', 'recycle', 'lead_id8', left(p_lead_id::text, 8), 'new_owner_id', p_new_employee_id, 'recycle_reason', p_recycle_reason));
      return;
    end if;
  end if;

  if v_lead_type = 'DATA' then
    v_deadline := null;
  else
    select sla_first_contact_minutes into v_sla_minutes from lead_engine_settings where id = 1;
    if v_sla_minutes is null then
      raise exception 'recycle_lead_atomic: lead_engine_settings row not found';
    end if;
    v_deadline := compute_working_hours_sla_deadline(now(), v_sla_minutes);
  end if;

  update lead_history set is_active = false, ended_reason = p_recycle_reason
  where id = p_old_lead_history_id and is_active = true;
  if not found then
    raise exception 'recycle_lead_atomic: lead_history % not found or already recycled (concurrent recycle?)', p_old_lead_history_id;
  end if;
  -- recycle_reason (2026-10-05): records WHY this assignment exists, on the
  -- new owner's own row (employees can only read their own lead_history).
  -- Display-only; no recycle/assignment/SLA logic reads it.
  -- recycled_from_status/_stage (2026-10-05): the lead's status and stage
  -- at the moment of recycling, read BEFORE the leads update below resets
  -- them to NEW/LEADS. Display-only, like recycle_reason.
  insert into lead_history (lead_id, employee_id, assigned_at, is_active, call_count, assigned_by_type, recycle_reason, recycled_from_status, recycled_from_stage)
  values (p_lead_id, p_new_employee_id, now(), true, 0, 'SYSTEM', p_recycle_reason,
    (select status from leads where id = p_lead_id), (select board_stage from leads where id = p_lead_id));
  update leads set current_owner_id = p_new_employee_id, status = 'NEW', board_stage = 'LEADS',
    sla_deadline = v_deadline, recycle_count = recycle_count + 1
  where id = p_lead_id
  returning name, lead_type into v_lead_name, v_lead_type;
  if not found then raise exception 'recycle_lead_atomic: lead % not found', p_lead_id; end if;
  update lead_engine_settings
  set round_robin_pointer_employee_id = p_next_pointer_employee_id,
      restricted_pool_pointer_employee_id = p_next_restricted_pool_pointer_employee_id
  where id = 1;
  select name into v_employee_name from employees where id = p_new_employee_id;
  insert into notification (employee_id, employee_name, title, message, type, is_read, related_lead_id)
  values (
    p_new_employee_id, coalesce(v_employee_name, ''),
    case when v_lead_type = 'DATA' then 'New Data Assigned' else 'New Lead Assigned' end,
    format('%s has been assigned to you.', coalesce(v_lead_name, 'A new lead')),
    case when v_lead_type = 'DATA' then 'DATA_ASSIGNED' else 'LEAD_ASSIGNED' end,
    false,
    p_lead_id
  );
end;
$function$;

drop function if exists public.restore_protection_until(uuid);
alter table lead_engine_settings drop column if exists restore_hold_mode;
notify pgrst, 'reload schema';
commit;
