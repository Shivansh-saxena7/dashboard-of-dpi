-- 2026-10-18 — DB sibling guard on the system recycle/assign paths. Rollback: 2026-10-18_db_sibling_guard_rollback.sql
--
-- recycle_lead_atomic and assign_lead_atomic, when called by service_role (recycle-stale-leads,
-- import distribution), refuse to give a LEAD to a new owner while the same number (last 10
-- digits, any project) is positive with ANOTHER active employee: FOLLOW_UP / VISIT / BOOKING
-- stage, VISIT_LOCK / VISIT_PENDING_VERIFICATION pause, or CONNECTED / CONVERTED status.
--   - new owner IS the holder           -> allowed
--   - admin / human paths (authenticated callers: create_manual_lead_atomic, reassign RPCs)
--                                        -> not checked
--   - DATA leads                         -> not checked
-- Refused recycle: nothing is reassigned; the current assignment gets paused_until = now()+1 day,
-- pause_reason 'SIBLING_HOLD', with both pause notifications pre-marked as sent (no "Snooze"
-- messages to the employee, no last_activity reset on expiry). recycle-stale-leads treats it
-- as PAUSED, so it is skipped before the per-sweep caps and normal recycles are not starved.
-- After a day it is re-checked; if the sibling is still positive it is held again.
-- Refused assignment: the lead stays unassigned (Admin assigns it by hand).
-- Both write log_anomaly('db_sibling_guard', 'warning', ...), merged into one row per hour
-- (occurrence_count). Both return normally, so any deployed edge build keeps working.
-- lead_history_pause_reason_check gains 'SIBLING_HOLD'.
-- Bodies below are the live 2026-10-18 definitions with only the guard added.

begin;

alter table lead_history drop constraint lead_history_pause_reason_check;
alter table lead_history add constraint lead_history_pause_reason_check
  check (pause_reason = any (array['SNOOZE'::text, 'VISIT_LOCK'::text, 'VISIT_PENDING_VERIFICATION'::text, 'SIBLING_HOLD'::text]));

create or replace function public.positive_sibling_block(p_lead_id uuid, p_new_owner uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- Same "positive" definition as positive_number_holders() / lib/positiveLead.ts.
  -- Returns the blocking holder, or null when the new owner may take the lead.
  select jsonb_build_object('holder_id8', left(s.id::text, 8), 'holder_owner_id', s.current_owner_id,
           'owner_name', e.name, 'stage',
           case when h.pause_reason in ('VISIT_LOCK', 'VISIT_PENDING_VERIFICATION') then 'VISIT'
                when s.board_stage in ('FOLLOW_UP', 'VISIT', 'BOOKING') then s.board_stage else s.status end,
           'mobile_last4', right(s.mobile_normalized, 4))
  from leads l
  join leads s on s.mobile_normalized = l.mobile_normalized and s.id <> l.id
  join employees e on e.id = s.current_owner_id and e.is_active
  left join lead_history h on h.lead_id = s.id and h.is_active
  where l.id = p_lead_id
    and l.mobile_normalized ~ '^[0-9]{10}$'
    and s.status <> 'JUNK' and s.merged_into_lead_id is null
    and s.current_owner_id is distinct from p_new_owner
    and (s.board_stage in ('FOLLOW_UP', 'VISIT', 'BOOKING')
         or s.status in ('CONNECTED', 'CONVERTED')
         or h.pause_reason in ('VISIT_LOCK', 'VISIT_PENDING_VERIFICATION'))
  order by (s.board_stage = 'VISIT' or coalesce(h.pause_reason, '') like 'VISIT%') desc, s.id
  limit 1;
$function$;

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

CREATE OR REPLACE FUNCTION public.assign_lead_atomic(p_lead_id uuid, p_employee_id uuid, p_next_pointer_employee_id uuid, p_next_restricted_pool_pointer_employee_id uuid, p_assigned_by_type text DEFAULT 'SYSTEM'::text, p_assigned_by_employee_id uuid DEFAULT NULL::uuid)
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
  if not exists (select 1 from employees where id = p_employee_id and is_active = true) then
    raise exception 'assign_lead_atomic: target employee % is not active', p_employee_id;
  end if;

  select lead_type into v_lead_type from leads where id = p_lead_id;
  if v_lead_type is null then
    raise exception 'assign_lead_atomic: lead % not found', p_lead_id;
  end if;

  -- DB sibling guard (2026-10-18): system distribution (service_role) may not give this
  -- LEAD to someone else while the same number is positive with another owner. Refused =
  -- the lead stays unassigned for Admin, one merged anomaly row, normal return.
  if v_lead_type <> 'DATA' and coalesce(auth.role(), '') = 'service_role' then
    v_block := positive_sibling_block(p_lead_id, p_employee_id);
    if v_block is not null then
      perform log_anomaly('db_sibling_guard', 'warning',
        format('Assignment refused: new lead %s would go to another employee while the same number is %s with %s (lead %s); left unassigned',
          left(p_lead_id::text, 8), v_block->>'stage', coalesce(v_block->>'owner_name', '-'), v_block->>'holder_id8'),
        v_block || jsonb_build_object('path', 'assign', 'lead_id8', left(p_lead_id::text, 8), 'new_owner_id', p_employee_id));
      return;
    end if;
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

revoke all on function public.positive_sibling_block(uuid, uuid) from public, anon, authenticated;

commit;
