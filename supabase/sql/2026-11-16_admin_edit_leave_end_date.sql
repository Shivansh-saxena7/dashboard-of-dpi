-- NOT APPLIED. 2026-11-16. Apply only on the owner's "haan", from an LF copy (git cat-file -p), rolled-back dry run first,
-- between sweeps, BEFORE the frontend merge.
-- Admin "Edit end date" for any leave period on /admin/leave (until now only an open-ended leave had "Mark Returned
-- Today", and no leave could be edited from the UI; Tanu's 12 - 15 Nov leave could not be ended on 14 Nov). Additive:
-- end_employee_leave_atomic stays as it is. Admin only (is_admin()), a reason is required, the new end date must not
-- be before the start date (refused, never deleted, unlike end_employee_leave_atomic) and must not run into another
-- leave of the same employee. Every change is recorded in lead_guard_events (source leave_edit, action
-- LEAVE_END_DATE_SET) with the old and new end date, the reason and who did it. No anon / PUBLIC access.
-- Rollback: 2026-11-16_admin_edit_leave_end_date_rollback.sql.
begin;

create function public.admin_edit_leave_end_date(p_leave_id uuid, p_end_date date, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_caller uuid := current_employee_id();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_row employee_leave_periods%rowtype;
begin
  if v_caller is null or not coalesce(is_admin(), false) then
    raise exception 'admin_edit_leave_end_date: caller is not an admin';
  end if;
  if v_reason = '' then
    raise exception 'admin_edit_leave_end_date: reason is required';
  end if;
  if p_end_date is null then
    raise exception 'admin_edit_leave_end_date: an end date is required';
  end if;

  select * into v_row from employee_leave_periods where id = p_leave_id for update;
  if v_row.id is null then
    raise exception 'admin_edit_leave_end_date: leave period not found';
  end if;
  if p_end_date < v_row.start_date then
    raise exception 'admin_edit_leave_end_date: the end date cannot be before the start date (%)', v_row.start_date;
  end if;
  if v_row.end_date is not distinct from p_end_date then
    raise exception 'admin_edit_leave_end_date: the leave already ends on %', p_end_date;
  end if;
  if exists (
    select 1 from employee_leave_periods o
    where o.employee_id = v_row.employee_id and o.id <> v_row.id
      and o.start_date <= p_end_date and (o.end_date is null or o.end_date >= v_row.start_date)
  ) then
    raise exception 'admin_edit_leave_end_date: this would overlap another leave of the same employee';
  end if;

  update employee_leave_periods set end_date = p_end_date where id = v_row.id;

  -- Written directly: log_guard_event joins leads by lead_id and would silently write nothing for a leave (no lead).
  insert into lead_guard_events (source, action, lead_id, lead_owner_id, mode, detail)
  values ('leave_edit', 'LEAVE_END_DATE_SET', null, v_row.employee_id, 'enforce', jsonb_build_object(
    'leave_id', v_row.id, 'employee_id', v_row.employee_id, 'start_date', v_row.start_date,
    'old_end_date', v_row.end_date, 'new_end_date', p_end_date, 'reason', v_reason, 'by_employee_id', v_caller));

  return jsonb_build_object('leave_id', v_row.id, 'old_end_date', v_row.end_date, 'new_end_date', p_end_date);
end;
$fn$;

revoke all on function public.admin_edit_leave_end_date(uuid, date, text) from public, anon;
grant execute on function public.admin_edit_leave_end_date(uuid, date, text) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.admin_edit_leave_end_date(uuid, date, text)', 'EXECUTE') then raise exception 'anon can execute'; end if;
  if not has_function_privilege('authenticated', 'public.admin_edit_leave_end_date(uuid, date, text)', 'EXECUTE') then raise exception 'authenticated cannot execute'; end if;
end $$;

commit;
