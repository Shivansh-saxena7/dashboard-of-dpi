-- 2026-10-18 — ROLLBACK for 2026-10-18_db_sibling_guard.sql: recycle_lead_atomic and
-- assign_lead_atomic back to their live 2026-10-18 bodies, helper dropped, every SIBLING_HOLD
-- released (back in the sweep at once), original pause_reason check restored.
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
begin
  if not exists (select 1 from employees where id = p_new_employee_id and is_active = true) then
    raise exception 'recycle_lead_atomic: target employee % is not active', p_new_employee_id;
  end if;

  select lead_type into v_lead_type from leads where id = p_lead_id;
  if v_lead_type is null then
    raise exception 'recycle_lead_atomic: lead % not found', p_lead_id;
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

CREATE OR REPLACE FUNCTION public.assign_lead_atomic(p_lead_id uuid, p_employee_id uuid, p_next_pointer_employee_id uuid, p_next_restricted_pool_pointer_employee_id uuid, p_assigned_by_type text DEFAULT 'SYSTEM'::text, p_assigned_by_employee_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lead_name text; v_lead_type text; v_employee_name text;
  v_sla_minutes int; v_deadline timestamptz;
begin
  if not exists (select 1 from employees where id = p_employee_id and is_active = true) then
    raise exception 'assign_lead_atomic: target employee % is not active', p_employee_id;
  end if;

  select lead_type into v_lead_type from leads where id = p_lead_id;
  if v_lead_type is null then
    raise exception 'assign_lead_atomic: lead % not found', p_lead_id;
  end if;

  if v_lead_type = 'DATA' then
    v_deadline := null;
  else
    select sla_first_contact_minutes into v_sla_minutes from lead_engine_settings where id = 1;
    if v_sla_minutes is null then
      raise exception 'assign_lead_atomic: lead_engine_settings row not found';
    end if;
    v_deadline := compute_working_hours_sla_deadline(now(), v_sla_minutes);
  end if;

  update leads set current_owner_id = p_employee_id, sla_deadline = v_deadline
  where id = p_lead_id and current_owner_id is null
  returning name, lead_type into v_lead_name, v_lead_type;
  if not found then
    raise exception 'assign_lead_atomic: lead % not found or already assigned (concurrent assignment?)', p_lead_id;
  end if;
  insert into lead_history (lead_id, employee_id, assigned_at, is_active, assigned_by_type, assigned_by_employee_id)
  values (p_lead_id, p_employee_id, now(), true, p_assigned_by_type, p_assigned_by_employee_id);
  update lead_engine_settings
  set round_robin_pointer_employee_id = p_next_pointer_employee_id,
      restricted_pool_pointer_employee_id = p_next_restricted_pool_pointer_employee_id
  where id = 1;
  select name into v_employee_name from employees where id = p_employee_id;
  insert into notification (employee_id, employee_name, title, message, type, is_read, related_lead_id)
  values (
    p_employee_id, coalesce(v_employee_name, ''),
    case when v_lead_type = 'DATA' then 'New Data Assigned' else 'New Lead Assigned' end,
    format('%s has been assigned to you.', coalesce(v_lead_name, 'A new lead')),
    case when v_lead_type = 'DATA' then 'DATA_ASSIGNED' else 'LEAD_ASSIGNED' end,
    false,
    p_lead_id
  );
end;
$function$;

drop function if exists public.positive_sibling_block(uuid, uuid);

update lead_history set paused_until = now(), pause_reason = null where pause_reason = 'SIBLING_HOLD';
alter table lead_history drop constraint lead_history_pause_reason_check;
alter table lead_history add constraint lead_history_pause_reason_check
  check (pause_reason = any (array['SNOOZE'::text, 'VISIT_LOCK'::text, 'VISIT_PENDING_VERIFICATION'::text]));

commit;
