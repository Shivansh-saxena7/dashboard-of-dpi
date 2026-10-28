-- 2026-10-28 — ROLLBACK for 2026-10-28_guard_events_conflicts.sql: the four functions back to their live
-- 2026-10-28 bodies (no event logging, nightly trap count as before), view/RPCs/helper dropped.
-- The lead_guard_events table is kept (history); drop it explicitly if wanted:
--   drop table if exists public.lead_guard_events;
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

CREATE OR REPLACE FUNCTION public.mark_lead_junk_atomic(p_lead_id uuid, p_lead_history_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin record;
  v_lead_name text;
  v_block text;
begin
  -- DB-side auto-junk guard (2026-10-18): only checked for non-admin callers (the sweep).
  if not coalesce((select is_admin()), false) then
    v_block := auto_junk_window_check(p_lead_id, p_lead_history_id);
    if v_block is not null then
      perform log_anomaly('db_auto_junk_guard', 'error',
        format('Auto-junk refused for lead %s: %s (reason given: %s)', left(p_lead_id::text, 8), v_block, coalesce(p_reason, '-')),
        jsonb_build_object('lead_id8', left(p_lead_id::text, 8), 'lead_history_id', p_lead_history_id, 'block', v_block,
          'reason', p_reason, 'recycle_count', (select recycle_count from leads where id = p_lead_id)));
      raise warning 'mark_lead_junk_atomic: refused for %: %', left(p_lead_id::text, 8), v_block;
      return;
    end if;
  end if;

  select name into v_lead_name from leads where id = p_lead_id;
  update leads
  set status = 'JUNK'
  where id = p_lead_id;
  if not found then
    raise exception 'mark_lead_junk_atomic: lead % not found', p_lead_id;
  end if;
  update lead_history
  set is_active = false,
      ended_reason = 'JUNK'
  where id = p_lead_history_id
    and is_active = true;
  if not found then
    raise exception 'mark_lead_junk_atomic: lead_history % not found or already inactive', p_lead_history_id;
  end if;
  for v_admin in select id, name from employees where role in ('admin', 'super_admin') and is_active = true
  loop
    insert into notification (employee_id, employee_name, title, message, type, is_read)
    values (
      v_admin.id,
      v_admin.name,
      'Lead marked JUNK',
      format('%s was auto-marked JUNK (%s) — flagged for review.', coalesce(v_lead_name, 'A lead'), p_reason),
      'LEAD_JUNKED',
      false
    );
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.run_lead_integrity_checks()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_dup int; v_junk int; v_junk_p95 numeric; v_trap int; v_orphan int;
begin
  -- new LEAD duplicate groups (same number + project, 2+ open, one created in the last 24h)
  select count(*) into v_dup from (
    select l.mobile_normalized, lower(btrim(coalesce(l.project, '')))
    from leads l
    where l.lead_type = 'LEAD' and l.status <> 'JUNK' and l.merged_into_lead_id is null and l.mobile_normalized ~ '^[0-9]{10}$'
    group by 1, 2
    having count(*) > 1 and max(l.created_at) > now() - interval '24 hours') g;
  if v_dup > 0 then
    perform log_anomaly('integrity_new_duplicate_groups', 'warning', format('%s new LEAD duplicate group(s) in the last 24h', v_dup), jsonb_build_object('groups', v_dup));
  end if;

  -- auto-junk spike: last 24h vs the daily p95 of the previous 30 days
  select count(*) into v_junk from leads l
  where l.status = 'JUNK' and l.merged_into_lead_id is null and l.updated_at > now() - interval '24 hours'
    and exists (select 1 from lead_history h where h.lead_id = l.id and h.ended_reason = 'JUNK' and not h.is_active);
  select percentile_cont(0.95) within group (order by n) into v_junk_p95 from (
    select date_trunc('day', l.updated_at) d, count(*) n from leads l
    where l.status = 'JUNK' and l.merged_into_lead_id is null
      and l.updated_at between now() - interval '31 days' and now() - interval '24 hours'
      and exists (select 1 from lead_history h where h.lead_id = l.id and h.ended_reason = 'JUNK')
    group by 1) x;
  if v_junk > greatest(coalesce(v_junk_p95, 0) * 1.5, 30) then
    perform log_anomaly('integrity_junk_spike', 'error', format('%s leads junked in the last 24h (30-day daily p95: %s)', v_junk, round(coalesce(v_junk_p95, 0))),
      jsonb_build_object('junked_24h', v_junk, 'p95', v_junk_p95));
  end if;

  -- 3rd-recycle trap pattern: rc>=3 junked within 30 min of a SYSTEM assignment
  select count(*) into v_trap from leads l
  join lateral (select * from lead_history x where x.lead_id = l.id order by x.assigned_at desc limit 1) h on true
  where l.status = 'JUNK' and l.merged_into_lead_id is null and l.recycle_count >= 3 and h.ended_reason = 'JUNK'
    and h.assigned_by_type = 'SYSTEM' and l.updated_at > now() - interval '24 hours' and l.updated_at - h.assigned_at < interval '30 minutes';
  if v_trap > 0 then
    perform log_anomaly('integrity_recycle_junk_trap', 'error', format('%s lead(s) junked within 30 min of their 3rd recycle', v_trap), jsonb_build_object('leads', v_trap));
  end if;

  -- open, owned leads with no active assignment (would vanish from the owner's list)
  select count(*) into v_orphan from leads l
  where l.status <> 'JUNK' and l.merged_into_lead_id is null and l.current_owner_id is not null
    and not exists (select 1 from lead_history h where h.lead_id = l.id and h.is_active);
  if v_orphan > 0 then
    perform log_anomaly('integrity_no_active_assignment', 'error', format('%s open lead(s) have an owner but no active assignment', v_orphan), jsonb_build_object('leads', v_orphan));
  end if;

  return jsonb_build_object('new_duplicate_groups', v_dup, 'junked_24h', v_junk, 'junk_p95', v_junk_p95, 'trap', v_trap, 'no_active_assignment', v_orphan);
end;
$function$;

drop function if exists public.get_guard_events(int);
drop function if exists public.get_positive_conflicts();
drop view if exists public.positive_conflicts;
drop function if exists public.log_guard_event(text, text, uuid, jsonb);

commit;
