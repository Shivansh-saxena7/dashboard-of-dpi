-- APPLIED 2026-11-18 13:32 IST, live (restore_junk_lead_to_owner, company_working_day, employee_in_return_grace). The
-- "NOT APPLIED" note below is from before the apply. helpers: service_role EXECUTE retained by decision (server-only
-- key; anon, PUBLIC and authenticated have no EXECUTE on them). Rollback: 2026-11-18_restore_junk_lead_to_owner_rollback.sql.
-- NOT APPLIED. 2026-11-18. Apply only on the owner's "haan", from an LF copy (git cat-file -p), rolled-back dry run first,
-- between sweeps.
-- Admin "give this junk lead back" for one positive lead, LEAD or DATA (restore_positive_junk_leads refuses DATA copies
-- and works in batches; this is the one-lead path, e.g. f6a6db10 junked on 15 Nov after two Not Interested although it
-- had been Connected). Additive: restore_positive_junk_leads, unjunk_and_reassign_lead_atomic and positive_junk_rows
-- are not changed.
--   * Admin only (is_admin() and role admin / super_admin, same check as restore_positive_junk_leads), reason of at
--     least 5 characters.
--   * Only a JUNK lead that is not merged, and only with positive history: status / stage come from positive_junk_rows
--     (its highest positive point, e.g. CONNECTED / LEADS), never a closed state.
--   * Receiver: an active sales employee who is not on leave today and not in their return grace (the first 2 working
--     days after a leave ends, same rule as lib/ownerLeaveCalendar.ts returnGraceDays).
--   * Sibling guard as before (restore_sibling_block): if a positive copy of the number is with another employee the
--     lead is not moved (HELD).
--   * recycle_count 0 and last_unjunked_at now, like the existing restore / unjunk paths, so old Not Interested answers
--     do not count again; a fresh assignment for the receiver carrying the restored status.
--   * lead_restore_log row with restore_protection_days (14) of restore-hold protection; audit in lead_guard_events
--     (admin_restore / ADMIN_RESTORE_ONE) and lead_activity_log (ADMIN_RESTORE); the receiver is notified.
-- No anon / PUBLIC access; the two helpers below are internal (no EXECUTE for anyone but the owner).
-- Rollback: 2026-11-18_restore_junk_lead_to_owner_rollback.sql.
begin;

-- A company working day (IST calendar date): not the weekly off, not inside an active Admin HOLIDAY range that covers
-- the whole day. Same as lib/ownerLeaveCalendar.ts isCompanyWorkingDay.
create function public.company_working_day(p_day date)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(extract(dow from p_day)::int is distinct from (select sla_weekly_off_day from lead_engine_settings where id = 1), true)
     and not exists (
       select 1 from non_working_periods n
       where n.kind = 'HOLIDAY' and n.cancelled_at is null
         and n.starts_at <= (p_day::timestamp at time zone 'Asia/Kolkata')
         and n.ends_at >= ((p_day + 1)::timestamp at time zone 'Asia/Kolkata'))
$fn$;

-- In return grace today: not on leave today, and today is one of the first 2 company working days after one of the
-- employee's leaves ended (skipping days of their own leave). Same as lib/ownerLeaveCalendar.ts employeesInReturnGrace.
create function public.employee_in_return_grace(p_employee_id uuid, p_today date)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  r record;
  d date;
  found_days int;
  i int;
begin
  if exists (select 1 from employee_leave_periods l where l.employee_id = p_employee_id
             and l.start_date <= p_today and (l.end_date is null or l.end_date >= p_today)) then
    return false;
  end if;
  for r in select end_date from employee_leave_periods where employee_id = p_employee_id and end_date is not null and end_date < p_today loop
    d := r.end_date + 1;
    found_days := 0;
    i := 0;
    while i < 60 and found_days < 2 loop
      if company_working_day(d) and not exists (
           select 1 from employee_leave_periods l where l.employee_id = p_employee_id
             and l.start_date <= d and (l.end_date is null or l.end_date >= d)) then
        if d = p_today then return true; end if;
        found_days := found_days + 1;
      end if;
      exit when d >= p_today;
      d := d + 1;
      i := i + 1;
    end loop;
  end loop;
  return false;
end;
$fn$;

create function public.restore_junk_lead_to_owner(p_lead_id uuid, p_employee_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_admin uuid := current_employee_id();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_days int := (select restore_protection_days from lead_engine_settings where id = 1);
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_lead leads%rowtype;
  v_row record;
  v_emp record;
  v_block jsonb;
  v_hist uuid;
  v_act uuid;
  v_log uuid;
  v_until timestamptz;
begin
  if v_admin is null or not coalesce((select is_admin()), false) or coalesce(current_employee_role(), '') not in ('admin', 'super_admin') then
    raise exception 'restore_junk_lead_to_owner: admin only';
  end if;
  if v_reason is null or length(v_reason) < 5 then
    raise exception 'restore_junk_lead_to_owner: a reason (at least 5 characters) is required';
  end if;
  if v_days is null then
    raise exception 'restore_junk_lead_to_owner: lead_engine_settings row not found';
  end if;

  select * into v_lead from leads where id = p_lead_id for update;
  if v_lead.id is null then
    raise exception 'restore_junk_lead_to_owner: lead not found';
  end if;
  if v_lead.status is distinct from 'JUNK' or v_lead.merged_into_lead_id is not null then
    raise exception 'restore_junk_lead_to_owner: lead % is not junk (status %)', left(v_lead.id::text, 8), v_lead.status;
  end if;

  select * into v_row from positive_junk_rows(v_lead.id);
  if v_row.lead_id is null then
    raise exception 'restore_junk_lead_to_owner: lead % has no positive history, use the normal junk Reassign', left(v_lead.id::text, 8);
  end if;

  select id, name, is_active, department into v_emp from employees where id = p_employee_id;
  if v_emp.id is null or not v_emp.is_active or coalesce(v_emp.department, '') <> 'sales' then
    raise exception 'restore_junk_lead_to_owner: the receiver is not an active sales employee';
  end if;
  if exists (select 1 from employee_leave_periods l where l.employee_id = v_emp.id
             and l.start_date <= v_today and (l.end_date is null or l.end_date >= v_today)) then
    raise exception 'restore_junk_lead_to_owner: the receiver is on leave today';
  end if;
  if employee_in_return_grace(v_emp.id, v_today) then
    raise exception 'restore_junk_lead_to_owner: the receiver is in return grace after a leave';
  end if;

  v_block := restore_sibling_block(v_lead.id, v_emp.id);
  if v_block is not null then
    insert into lead_guard_events (source, action, lead_id, holder_lead_id8, lead_owner_id, holder_owner_id, project, mode, detail)
    values ('admin_restore', 'ADMIN_RESTORE_HELD', v_lead.id, v_block->>'holder_id8', v_emp.id, nullif(v_block->>'holder_owner_id', '')::uuid,
            v_lead.project, 'enforce', v_block || jsonb_build_object('to_employee_id', v_emp.id, 'reason', v_reason, 'by', v_admin));
    return jsonb_build_object('result', 'HELD', 'lead_id8', left(v_lead.id::text, 8),
                              'why', 'a positive copy of this number is with another employee', 'sibling', v_block);
  end if;

  v_until := now() + make_interval(days => v_days);

  update leads set
    status = v_row.restore_status,
    board_stage = v_row.restore_stage,
    board_stage_changed_at = now(),
    current_owner_id = v_emp.id,
    recycle_count = 0,
    last_unjunked_at = now(),
    sla_deadline = null
  where id = v_lead.id;

  insert into lead_history (lead_id, employee_id, assigned_at, is_active, call_count, assigned_by_type, assigned_by_employee_id,
                            reassign_note, outcome, outcome_at, last_activity_at)
  values (v_lead.id, v_emp.id, now(), true, 0, 'ADMIN', v_admin, 'Restored by admin: ' || v_reason,
          v_row.restore_status, now(), now())
  returning id into v_hist;

  insert into lead_activity_log (lead_id, lead_history_id, employee_id, activity_type, detail)
  values (v_lead.id, v_hist, v_admin, 'ADMIN_RESTORE', 'Restored by admin: ' || v_reason)
  returning id into v_act;

  insert into lead_restore_log (lead_id, restored_by, to_employee_id, reason, highest_positive, restored_status, restored_stage,
                                protected_until, sibling_bypassed, sibling, prev_state, new_lead_history_id, activity_id)
  values (v_lead.id, v_admin, v_emp.id, v_reason, v_row.highest_positive, v_row.restore_status, v_row.restore_stage,
          v_until, false, null,
          jsonb_build_object('status', v_lead.status, 'board_stage', v_lead.board_stage, 'board_stage_changed_at', v_lead.board_stage_changed_at,
                             'current_owner_id', v_lead.current_owner_id, 'recycle_count', v_lead.recycle_count,
                             'last_unjunked_at', v_lead.last_unjunked_at, 'sla_deadline', v_lead.sla_deadline, 'lead_type', v_lead.lead_type),
          v_hist, v_act)
  returning id into v_log;

  insert into lead_guard_events (source, action, lead_id, lead_owner_id, project, mode, detail)
  values ('admin_restore', 'ADMIN_RESTORE_ONE', v_lead.id, v_emp.id, v_lead.project, 'enforce',
          jsonb_build_object('reason', v_reason, 'by', v_admin, 'to_employee_id', v_emp.id, 'lead_type', coalesce(v_lead.lead_type, 'LEAD'),
                             'restored_status', v_row.restore_status, 'restored_stage', v_row.restore_stage, 'restore_log_id', v_log,
                             'protected_until', v_until,
                             'prev_state', jsonb_build_object('status', v_lead.status, 'board_stage', v_lead.board_stage,
                               'current_owner_id', v_lead.current_owner_id, 'recycle_count', v_lead.recycle_count)));

  insert into notification (employee_id, employee_name, title, message, type, is_read, related_lead_id)
  values (v_emp.id, coalesce(v_emp.name, ''), 'A lead you worked on was given back to you',
          format('%s is back on your list (%s). Open it and follow up.', coalesce(v_lead.name, 'A lead'),
                 initcap(replace(case when v_row.restore_stage <> 'LEADS' then v_row.restore_stage else v_row.restore_status end, '_', ' '))),
          'LEAD_RESTORED', false, v_lead.id);

  return jsonb_build_object('result', 'RESTORED', 'lead_id8', left(v_lead.id::text, 8), 'to_status', v_row.restore_status,
                            'to_stage', v_row.restore_stage, 'protected_until', v_until, 'restore_log_id', v_log);
end;
$fn$;

revoke all on function public.company_working_day(date) from public, anon, authenticated;
revoke all on function public.employee_in_return_grace(uuid, date) from public, anon, authenticated;
revoke all on function public.restore_junk_lead_to_owner(uuid, uuid, text) from public, anon;
grant execute on function public.restore_junk_lead_to_owner(uuid, uuid, text) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.restore_junk_lead_to_owner(uuid, uuid, text)', 'EXECUTE') then raise exception 'anon can execute'; end if;
  if not has_function_privilege('authenticated', 'public.restore_junk_lead_to_owner(uuid, uuid, text)', 'EXECUTE') then raise exception 'authenticated cannot execute'; end if;
  if has_function_privilege('authenticated', 'public.employee_in_return_grace(uuid, date)', 'EXECUTE') then raise exception 'helper is callable'; end if;
end $$;

commit;
