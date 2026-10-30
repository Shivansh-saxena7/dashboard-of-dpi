-- 2026-10-30 — Restore hold (G5 fix for restored / reassigned leads). NOT APPLIED — apply only after the owner's "haan" (LF copy).
-- Rollback: 2026-10-30_restore_hold_rollback.sql   Tests (dry-run only): 2026-10-30_restore_hold_tests.sql
--
-- A lead an admin restored (positive-junk restore) or reassigned keeping its state has a protection window in
-- lead_restore_log (14 days). The DB junk guard already honours it; this stops the recycle inside the same window.
-- Rule (same as lib/restoreHold.ts): a LEAD whose recycle / junk is due while protected_until > now is held.
-- DATA leads are never held. restore_hold_mode: 'off' | 'shadow' (default: the sweep and recycle_lead_atomic only
-- write lead_guard_events, once a day per lead) | 'enforce' (skipped / refused). The sweep reads the same setting.
-- Additive: one settings column, one helper, one early return in recycle_lead_atomic (every existing check kept).
begin;

alter table lead_engine_settings add column if not exists restore_hold_mode text not null default 'shadow';
alter table lead_engine_settings add constraint lead_engine_settings_restore_hold_mode_check
  check (restore_hold_mode in ('off', 'shadow', 'enforce'));

-- End of the open protection window of a lead, or null.
create or replace function public.restore_protection_until(p_lead_id uuid)
returns timestamptz language sql stable security definer set search_path to 'public' as $$
  select max(r.protected_until) from lead_restore_log r
  where r.lead_id = p_lead_id and r.undone_at is null and r.protected_until > now()
$$;
revoke all on function public.restore_protection_until(uuid) from public, anon, authenticated;
grant execute on function public.restore_protection_until(uuid) to service_role;

-- recycle_lead_atomic: live body of 2026-10-30 plus the restore hold block after the sibling guard (grants unchanged)
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
  v_hold_mode text; v_hold_until timestamptz;
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

  -- Restore hold (2026-10-30): inside a restore / reassign protection window (lead_restore_log) the
  -- sweep may not recycle a LEAD. restore_hold_mode 'enforce' = refused, nothing changes, one guard
  -- event, the call returns normally; 'shadow' = recycles as before, one guard event per lead per
  -- day; 'off' = nothing. The sweep itself already skips these leads in 'enforce'.
  if v_lead_type <> 'DATA' and coalesce(auth.role(), '') = 'service_role' then
    v_hold_mode := coalesce((select restore_hold_mode from lead_engine_settings where id = 1), 'off');
    v_hold_until := case when v_hold_mode in ('shadow', 'enforce') then restore_protection_until(p_lead_id) end;
    if v_hold_until is not null then
      if v_hold_mode = 'enforce' then
        perform log_guard_event('db_restore_hold', 'RECYCLE_REFUSED', p_lead_id,
          jsonb_build_object('protected_until', v_hold_until, 'new_owner_id', p_new_employee_id, 'recycle_reason', p_recycle_reason, 'mode', v_hold_mode));
        return;
      elsif not exists (select 1 from lead_guard_events g where g.source = 'db_restore_hold' and g.lead_id = p_lead_id
                        and g.created_at > now() - interval '1 day') then
        perform log_guard_event('db_restore_hold', 'RECYCLE_WOULD_REFUSE', p_lead_id,
          jsonb_build_object('protected_until', v_hold_until, 'new_owner_id', p_new_employee_id, 'recycle_reason', p_recycle_reason, 'mode', v_hold_mode));
      end if;
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

notify pgrst, 'reload schema';
commit;
