-- 2026-10-29 — NULL-safe role checks (39 functions). APPLIED 2026-10-29 16:37 IST (owner's "haan", LF copy of 654fa72); live verify 7/7.
-- Rollback: 2026-10-29_security_nullcheck_fix_rollback.sql (byte-exact copy outside git: C:/work/reports/nullcheck_rollback_exact.sql)
--
-- `if <role> not in ('admin', ...) then raise` does NOT raise when the role is NULL (no employee row, or no login),
-- because NULL not in (...) is NULL. Each such check becomes `if coalesce(<role>, '') not in (...)`. Nothing else in
-- the function bodies changes; create or replace keeps every grant.
begin;
-- adjust_advance_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.adjust_advance_atomic(p_advance_id uuid, p_amount numeric, p_adjusted_date date, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_id uuid;
  v_note text;
  v_advance record;
  v_remaining numeric;
  v_adjustment_id uuid;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin', 'payroll') then
    raise exception 'adjust_advance_atomic: caller is not authorized';
  end if;

  v_caller_id := current_employee_id();
  v_note := nullif(trim(p_note), '');

  if p_amount is null or p_amount <= 0 then
    raise exception 'adjust_advance_atomic: amount must be greater than zero';
  end if;
  if p_adjusted_date is null then
    raise exception 'adjust_advance_atomic: adjusted_date is required';
  end if;

  select ea.id, ea.status, ea.amount - coalesce((select sum(aa.amount) from advance_adjustments aa where aa.advance_id = ea.id), 0) as remaining
  into v_advance
  from employee_advances ea
  where ea.id = p_advance_id
  for update;

  if v_advance.id is null then
    raise exception 'adjust_advance_atomic: advance % not found', p_advance_id;
  end if;
  if v_advance.status = 'FULLY_ADJUSTED' then
    raise exception 'adjust_advance_atomic: advance % is already fully adjusted', p_advance_id;
  end if;
  if p_amount > v_advance.remaining then
    raise exception 'adjust_advance_atomic: amount % exceeds remaining balance %', p_amount, v_advance.remaining;
  end if;

  insert into advance_adjustments (advance_id, amount, adjusted_date, note, adjusted_by_employee_id)
  values (p_advance_id, p_amount, p_adjusted_date, v_note, v_caller_id)
  returning id into v_adjustment_id;

  v_remaining := v_advance.remaining - p_amount;
  if v_remaining <= 0 then
    update employee_advances set status = 'FULLY_ADJUSTED' where id = p_advance_id;
  end if;

  return v_adjustment_id;
end;
$function$;

-- admin_create_meta_dataset: 1 check(s)
CREATE OR REPLACE FUNCTION public.admin_create_meta_dataset(p_label text, p_dataset_id text, p_access_token text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_secret_id uuid;
  v_dataset_row_id uuid;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin') then
    raise exception 'admin_create_meta_dataset: caller is not an admin';
  end if;

  if p_label is null or length(trim(p_label)) = 0 then
    raise exception 'admin_create_meta_dataset: label is required';
  end if;

  if p_dataset_id is null or length(trim(p_dataset_id)) = 0 then
    raise exception 'admin_create_meta_dataset: dataset_id is required';
  end if;

  if p_access_token is null or length(trim(p_access_token)) = 0 then
    raise exception 'admin_create_meta_dataset: access_token is required';
  end if;

  -- Random secret name (not the label) — the label is user-editable
  -- display text; the vault secret's own name should never need to
  -- change just because someone renames the dataset in the UI later.
  v_secret_id := vault.create_secret(
    p_access_token,
    'meta_capi_' || gen_random_uuid()::text,
    'Meta CAPI access token for dataset: ' || p_label
  );

  insert into meta_datasets (label, dataset_id, access_token_secret_id)
  values (trim(p_label), trim(p_dataset_id), v_secret_id)
  returning id into v_dataset_row_id;

  return v_dataset_row_id;
end;
$function$;

-- admin_rotate_meta_dataset_token: 1 check(s)
CREATE OR REPLACE FUNCTION public.admin_rotate_meta_dataset_token(p_dataset_id uuid, p_new_access_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_secret_id uuid;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin') then
    raise exception 'admin_rotate_meta_dataset_token: caller is not an admin';
  end if;

  if p_new_access_token is null or length(trim(p_new_access_token)) = 0 then
    raise exception 'admin_rotate_meta_dataset_token: access_token is required';
  end if;

  select access_token_secret_id into v_secret_id
  from meta_datasets
  where id = p_dataset_id;

  if v_secret_id is null then
    raise exception 'admin_rotate_meta_dataset_token: dataset % not found', p_dataset_id;
  end if;

  perform vault.update_secret(v_secret_id, new_secret := p_new_access_token);

  update meta_datasets set updated_at = now() where id = p_dataset_id;
end;
$function$;

-- approve_booking_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.approve_booking_atomic(p_request_id uuid, p_points integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req booking_requests%rowtype;
  v_status text;
  v_stage text;
  v_owner uuid;
  v_lead_name text;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin', 'sales_coordinator') then
    raise exception 'approve_booking_atomic: only Admin or Sales Coordinator can approve a booking';
  end if;
  select * into v_req from booking_requests where id = p_request_id for update;
  if not found then
    raise exception 'approve_booking_atomic: booking request % not found', p_request_id;
  end if;
  if v_req.status <> 'PENDING' then
    raise exception 'approve_booking_atomic: this booking request was already %', lower(v_req.status);
  end if;
  select status, board_stage, current_owner_id, name into v_status, v_stage, v_owner, v_lead_name
    from leads where id = v_req.lead_id for update;
  if v_owner is distinct from v_req.employee_id then
    raise exception 'approve_booking_atomic: the lead is no longer with the employee who requested the booking — reject this request';
  end if;
  if v_status = 'JUNK' or is_lead_terminal(v_status, v_stage) then
    raise exception 'approve_booking_atomic: the lead is already closed or junk — reject this request';
  end if;

  perform book_lead_internal(v_req.lead_id, v_req.employee_id, p_points, v_req.size);

  -- The pending-booking pause ends with the decision.
  update lead_history
  set paused_until = null, pause_reason = null, pause_note = null,
      pause_verified_by = current_employee_id(), pause_verified_at = now(),
      pause_expiry_warning_sent_at = null, pause_expired_notified_at = null
  where lead_id = v_req.lead_id and employee_id = v_req.employee_id and is_active = true
    and pause_reason = 'VISIT_PENDING_VERIFICATION' and pause_note = 'Booking pending approval';

  update booking_requests set status = 'APPROVED', decided_by = current_employee_id(), decided_at = now() where id = p_request_id;

  insert into notification (employee_id, employee_name, title, message, type, is_read, related_lead_id)
  select e.id, e.name, 'Booking approved',
         format('Your booking for %s was approved.', coalesce(v_lead_name, 'a lead')),
         'BOOKING_APPROVED', false, v_req.lead_id
  from employees e where e.id = v_req.employee_id;
end;
$function$;

-- approve_expense_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.approve_expense_atomic(p_expense_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_id uuid; v_employee_id uuid; v_amount numeric;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin', 'payroll') then
    raise exception 'approve_expense_atomic: caller is not authorized';
  end if;
  v_caller_id := current_employee_id();

  select employee_id, amount into v_employee_id, v_amount
  from expenses where id = p_expense_id and status = 'PENDING' and expense_source = 'EMPLOYEE_SUBMITTED';

  if v_employee_id is null then
    raise exception 'approve_expense_atomic: expense % not found or not pending', p_expense_id;
  end if;

  update expenses
  set status = 'APPROVED', reviewed_by_employee_id = v_caller_id, reviewed_at = now()
  where id = p_expense_id and status = 'PENDING';

  if not found then
    raise exception 'approve_expense_atomic: expense % was already decided concurrently', p_expense_id;
  end if;

  insert into notification (employee_id, employee_name, title, message, type, is_read)
  select v_employee_id, coalesce(e.name, ''),
    'Expense Approved',
    format('Your expense of %s was approved.', v_amount::text),
    'EXPENSE_APPROVED', false
  from employees e where e.id = v_employee_id;
end;
$function$;

-- approve_lead_transfer_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.approve_lead_transfer_atomic(p_request_id uuid, p_new_employee_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin_id uuid;
  v_lead_id uuid;
  v_requested_by uuid;
  v_reason text;
  v_lead_name text;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin') then
    raise exception 'approve_lead_transfer_atomic: caller is not an admin';
  end if;
  v_admin_id := current_employee_id();

  select lead_id, requested_by_employee_id, reason
    into v_lead_id, v_requested_by, v_reason
  from lead_transfer_requests
  where id = p_request_id and status = 'PENDING';

  if v_lead_id is null then
    raise exception 'approve_lead_transfer_atomic: request % not found or not pending', p_request_id;
  end if;

  if not exists (
    select 1 from leads where id = v_lead_id and current_owner_id = v_requested_by
  ) then
    raise exception 'approve_lead_transfer_atomic: lead ownership changed since this request was made -- reject this stale request instead';
  end if;

  -- Claim the request row first (atomic optimistic-concurrency check,
  -- same idiom as force_reassign_lead_atomic's own update-then-check-FOUND
  -- pattern) before running the side-effecting reassignment below -- both
  -- happen in the same transaction, so either both land or neither does.
  update lead_transfer_requests
  set status = 'APPROVED',
      transferred_to_employee_id = p_new_employee_id,
      reviewed_by_admin_id = v_admin_id,
      reviewed_at = now(),
      updated_at = now()
  where id = p_request_id and status = 'PENDING';

  if not found then
    raise exception 'approve_lead_transfer_atomic: request % was already decided concurrently', p_request_id;
  end if;

  -- Reuse the existing admin-reassign RPC rather than duplicating its
  -- ownership move / lead_history / lead_forced_removals / notify-new-owner
  -- logic -- also why this can never disturb the round-robin pointer
  -- (force_reassign_lead_atomic never calls assign_lead_atomic).
  perform force_reassign_lead_atomic(
    p_lead_id => v_lead_id,
    p_new_employee_id => p_new_employee_id,
    p_reason => format('Approved transfer request: %s', v_reason)
  );

  select name into v_lead_name from leads where id = v_lead_id;
  insert into notification (employee_id, employee_name, title, message, type, is_read)
  select v_requested_by, coalesce(e.name, ''),
    'Transfer Request Approved',
    format('Your transfer request for %s was approved and reassigned.', coalesce(v_lead_name, 'the lead')),
    'LEAD_TRANSFER_APPROVED', false
  from employees e where e.id = v_requested_by;
end;
$function$;

-- bulk_reassign_leads_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.bulk_reassign_leads_atomic(p_lead_ids uuid[], p_new_employee_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reason text;
  v_lead_id uuid;
  v_results jsonb := '[]'::jsonb;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin') then
    raise exception 'bulk_reassign_leads_atomic: caller is not an admin';
  end if;

  v_reason := nullif(trim(p_reason), '');
  if v_reason is null then
    raise exception 'bulk_reassign_leads_atomic: reason is required';
  end if;

  if p_lead_ids is null or array_length(p_lead_ids, 1) is null then
    raise exception 'bulk_reassign_leads_atomic: no leads selected';
  end if;

  -- Each lead reuses force_reassign_lead_atomic directly -- same
  -- ownership move / lead_history / lead_forced_removals / notification
  -- as a single manual reassign, so nothing about "what a reassign does"
  -- is duplicated here. The nested begin/exception per iteration is a
  -- real PL/pgSQL savepoint -- one bad lead (already reassigned
  -- concurrently, already terminal, etc.) only fails that lead; leads
  -- already processed earlier in the loop stay committed, and the loop
  -- continues to the rest instead of aborting the whole batch.
  foreach v_lead_id in array p_lead_ids loop
    begin
      perform force_reassign_lead_atomic(v_lead_id, p_new_employee_id, v_reason);
      v_results := v_results || jsonb_build_object('lead_id', v_lead_id, 'success', true);
    exception when others then
      v_results := v_results || jsonb_build_object('lead_id', v_lead_id, 'success', false, 'error', sqlerrm);
    end;
  end loop;

  return v_results;
end;
$function$;

-- convert_candidate_to_employee_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.convert_candidate_to_employee_atomic(p_candidate_id uuid, p_auth_user_id uuid, p_email text, p_role text DEFAULT 'employee'::text, p_department text DEFAULT 'sales'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_candidate record;
  v_new_employee_id uuid;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin', 'hr') then
    raise exception 'convert_candidate_to_employee_atomic: caller is not authorized';
  end if;

  select * into v_candidate from candidates where id = p_candidate_id;
  if v_candidate is null then
    raise exception 'convert_candidate_to_employee_atomic: candidate % not found', p_candidate_id;
  end if;

  if v_candidate.status = 'CONVERTED' then
    raise exception 'convert_candidate_to_employee_atomic: candidate % already converted', p_candidate_id;
  end if;

  insert into employees (name, auth_user_id, email, role, is_active, department)
  values (v_candidate.name, p_auth_user_id, p_email, p_role, true, p_department)
  returning id into v_new_employee_id;

  update candidates
  set status = 'CONVERTED', converted_employee_id = v_new_employee_id
  where id = p_candidate_id;

  return v_new_employee_id;
end;
$function$;

-- count_project_reassign_leads: 1 check(s)
CREATE OR REPLACE FUNCTION public.count_project_reassign_leads(p_project text, p_old_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin') then
    raise exception 'count_project_reassign_leads: caller is not an admin';
  end if;
  return (
    select jsonb_build_object('total', count(*), 'positive', count(*) filter (where
      l.board_stage in ('FOLLOW_UP', 'VISIT', 'BOOKING')
      or l.status in ('CONNECTED', 'CONVERTED')
      or coalesce(lh.pause_reason, '') in ('VISIT_LOCK', 'VISIT_PENDING_VERIFICATION')))
    from leads l
    join lead_history lh on lh.lead_id = l.id and lh.is_active = true
    where l.current_owner_id = p_old_employee_id
      and trim(lower(l.project)) = trim(lower(p_project)));
end;
$function$;

-- create_manual_booking_lead_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.create_manual_booking_lead_atomic(p_employee_id uuid, p_project text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lead_id uuid;
  v_pointer uuid;
  v_restricted_pointer uuid;
  v_employee_name text;
  v_project text;
  v_placeholder_name text;
  v_placeholder_mobile text;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin') then
    raise exception 'create_manual_booking_lead_atomic: caller is not authorized';
  end if;

  if not exists (select 1 from employees where id = p_employee_id and is_active = true) then
    raise exception 'create_manual_booking_lead_atomic: target employee % is not active', p_employee_id;
  end if;

  v_project := nullif(trim(p_project), '');
  if v_project is null then
    raise exception 'create_manual_booking_lead_atomic: project is required';
  end if;

  select name into v_employee_name from employees where id = p_employee_id;

  -- No client identity is ever collected for a manual/retroactive
  -- booking -- same privacy stance the celebration itself has always
  -- had (it has never shown a client name/mobile). leads.name and
  -- leads.mobile are both NOT NULL though, so a clearly-labeled
  -- placeholder stands in for each -- never a real client's data, and
  -- the mobile placeholder is timestamp-suffixed so multiple manual
  -- entries never collide with each other.
  v_placeholder_name := 'Manual Entry - ' || coalesce(v_employee_name, 'Unknown') || ' - ' || to_char(now(), 'DD Mon YYYY');
  v_placeholder_mobile := 'MANUAL-' || to_char(now(), 'YYYYMMDDHH24MISS');

  insert into leads (name, mobile, project, source, lead_type)
  values (v_placeholder_name, v_placeholder_mobile, v_project, 'Manual Booking Entry', 'LEAD')
  returning id into v_lead_id;

  -- Same no-op-pointer trick create_manual_lead_atomic uses: read the
  -- CURRENT round-robin pointer and hand it straight back in, so this
  -- manual/out-of-band assignment never advances (or otherwise
  -- disturbs) the live queue for real incoming leads.
  select round_robin_pointer_employee_id, restricted_pool_pointer_employee_id
    into v_pointer, v_restricted_pointer
    from lead_engine_settings where id = 1;

  -- p_next_restricted_pool_pointer_employee_id (2026-10-03 fix) -- same
  -- missed-caller bug create_personal_lead_atomic got fixed for on
  -- 2026-10-01: assign_lead_atomic grew this non-default param on
  -- 2026-09-25 and unconditionally writes it into lead_engine_settings,
  -- so pass the CURRENT value straight back unchanged (a manual pick
  -- never consumes a turn from either rotation).
  perform assign_lead_atomic(
    p_lead_id => v_lead_id,
    p_employee_id => p_employee_id,
    p_next_pointer_employee_id => v_pointer,
    p_next_restricted_pool_pointer_employee_id => v_restricted_pointer,
    p_assigned_by_type => 'ADMIN',
    p_assigned_by_employee_id => current_employee_id()
  );

  return v_lead_id;
end;
$function$;

-- create_manual_lead_atomic: 2 check(s)
CREATE OR REPLACE FUNCTION public.create_manual_lead_atomic(p_name text, p_mobile text, p_email text, p_project text, p_priority text, p_catcher_name text, p_employee_id uuid, p_override_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_id uuid;
  v_caller_role text;
  v_assigned_by_type text;
  v_lead_id uuid;
  v_pointer uuid;
  v_restricted_pointer uuid;
  v_name text;
  v_mobile text;
  v_catcher_name text;
  v_employee_name text;
  v_conflicts jsonb;
  v_override_reason text;
begin
  v_caller_role := current_employee_role();
  if coalesce(v_caller_role, '') not in ('admin', 'super_admin', 'sales_coordinator') then
    raise exception 'create_manual_lead_atomic: caller is not authorized';
  end if;

  v_caller_id := current_employee_id();
  if v_caller_id is null then
    raise exception 'create_manual_lead_atomic: caller is not a recognized employee';
  end if;

  v_name := nullif(trim(p_name), '');
  v_mobile := nullif(trim(p_mobile), '');
  v_catcher_name := nullif(trim(p_catcher_name), '');

  if v_name is null then
    raise exception 'create_manual_lead_atomic: name is required';
  end if;
  if v_mobile is null then
    raise exception 'create_manual_lead_atomic: mobile is required';
  end if;
  if v_catcher_name is null then
    raise exception 'create_manual_lead_atomic: catcher name is required';
  end if;

  if not exists (select 1 from employees where id = p_employee_id and is_active = true) then
    raise exception 'create_manual_lead_atomic: target employee % is not active', p_employee_id;
  end if;

  -- Duplicate check (2026-10-03) -- lead_conflicts_core is the single
  -- owner of the (mobile, canonical project) rule. A conflict is NOT a
  -- hard block for Admin: the UI shows the existing owner(s) first via
  -- find_lead_conflicts, and Admin can create anyway with a reason
  -- (logged to lead_duplicate_overrides below). Coordinators get the
  -- block without the override, per the approved 'Admin override' rule.
  v_conflicts := lead_conflicts_core(
    jsonb_build_array(jsonb_build_object('mobile', v_mobile, 'project', p_project))
  );
  v_override_reason := nullif(trim(p_override_reason), '');

  if jsonb_array_length(v_conflicts) > 0 then
    if coalesce(v_caller_role, '') not in ('admin', 'super_admin') then
      raise exception 'create_manual_lead_atomic: DUPLICATE_LEAD -- this client already has a lead for this project (or no project was given). Ask an Admin to create it with an override reason.';
    end if;
    if v_override_reason is null then
      raise exception 'create_manual_lead_atomic: DUPLICATE_LEAD -- this client already has a lead for this project (or no project was given); a reason is required to create it anyway';
    end if;
  end if;

  insert into leads (name, mobile, email, project, source, priority, lead_type, catcher_name)
  values (
    v_name,
    v_mobile,
    nullif(trim(p_email), ''),
    nullif(trim(p_project), ''),
    'Catcher',
    coalesce(nullif(trim(p_priority), ''), 'cold'),
    'LEAD',
    v_catcher_name
  )
  returning id into v_lead_id;

  select round_robin_pointer_employee_id, restricted_pool_pointer_employee_id
    into v_pointer, v_restricted_pointer
    from lead_engine_settings where id = 1;

  v_assigned_by_type := case when v_caller_role in ('admin', 'super_admin') then 'ADMIN' else 'SALES_COORDINATOR' end;

  -- p_next_restricted_pool_pointer_employee_id (2026-10-03 fix) -- same
  -- missed-caller bug create_personal_lead_atomic got fixed for on
  -- 2026-10-01: assign_lead_atomic grew this non-default param on
  -- 2026-09-25 and unconditionally writes it into lead_engine_settings,
  -- so pass the CURRENT value straight back unchanged (a manual pick
  -- never consumes a turn from either rotation).
  perform assign_lead_atomic(
    p_lead_id => v_lead_id,
    p_employee_id => p_employee_id,
    p_next_pointer_employee_id => v_pointer,
    p_next_restricted_pool_pointer_employee_id => v_restricted_pointer,
    p_assigned_by_type => v_assigned_by_type,
    p_assigned_by_employee_id => v_caller_id
  );

  -- Catcher leads are inherently a Visit — the client was already
  -- physically on-site when the Catcher caught them, so there's no
  -- "first contact" SLA to wait on, and the visit itself is already
  -- as verified as it's ever going to get (Admin/Coordinator heard
  -- it directly from the Catcher — stronger confirmation than the
  -- WhatsApp-photo evidence a normal employee-reported visit gets).
  -- Reuses the exact same site_visits / pause_reason='VISIT_LOCK'
  -- shape verify_site_visit_atomic produces, just pre-verified at
  -- creation instead of via a separate Coordinator review step — so
  -- it plugs into every existing report/history/summary that already
  -- reads those tables, without a new parallel mechanism. Overwrites
  -- the normal SLA-deadline assign_lead_atomic just set above.
  update leads
  set board_stage = 'VISIT',
      board_stage_changed_at = now(),
      sla_deadline = null
  where id = v_lead_id;

  update lead_history
  set pause_reason = 'VISIT_LOCK',
      paused_until = now() + interval '1 month',
      pause_verified_by = v_caller_id,
      pause_verified_at = now(),
      last_activity_at = now()
  where lead_id = v_lead_id and employee_id = p_employee_id and is_active = true;

  -- Same points value a normal VISIT event awards (see
  -- lib/calculateLeadPoints.ts's LEAD_POINTS.VISIT) — the assigned
  -- employee now owns closing this lead, so they keep the usual
  -- visit-credit even though the Catcher did the actual catching.
  insert into site_visits (lead_id, employee_id, event_type, points, verified_at, verified_by)
  values (v_lead_id, p_employee_id, 'VISIT', 1, now(), v_caller_id);

  select name into v_employee_name from employees where id = p_employee_id;
  insert into notification (employee_id, employee_name, title, message, type, is_read)
  values (
    p_employee_id,
    coalesce(v_employee_name, ''),
    'Catcher Lead — Already a Visit',
    format(
      'This lead came from Catcher %s — the client was already on-site, so this is already a Visit (locked to you for a month) with no first-contact SLA timer.',
      v_catcher_name
    ),
    'CATCHER_LEAD_VISIT',
    false
  );

  if jsonb_array_length(v_conflicts) > 0 then
    insert into lead_duplicate_overrides (lead_id, conflicting_lead_ids, reason, created_by_employee_id)
    select v_lead_id, array_agg((h->>'lead_id')::uuid), v_override_reason, v_caller_id
    from jsonb_array_elements(v_conflicts->0->'existing') h;
  end if;

  return v_lead_id;
end;
$function$;

-- create_sim_assignment_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.create_sim_assignment_atomic(p_sim_number text, p_email_address text, p_email_password text, p_employee_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_id uuid;
  v_sim_number text;
  v_email_address text;
  v_reason text;
  v_secret_id uuid;
  v_sim_assignment_id uuid;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin', 'hr') then
    raise exception 'create_sim_assignment_atomic: caller is not authorized';
  end if;

  v_caller_id := current_employee_id();

  v_sim_number := nullif(trim(p_sim_number), '');
  v_email_address := nullif(trim(p_email_address), '');
  v_reason := nullif(trim(p_reason), '');

  if v_sim_number is null then
    raise exception 'create_sim_assignment_atomic: sim_number is required';
  end if;
  if v_email_address is null then
    raise exception 'create_sim_assignment_atomic: email_address is required';
  end if;
  if p_email_password is null or length(p_email_password) = 0 then
    raise exception 'create_sim_assignment_atomic: email_password is required';
  end if;
  if v_reason is null then
    raise exception 'create_sim_assignment_atomic: reason is required';
  end if;

  if not exists (select 1 from employees where id = p_employee_id and is_active = true) then
    raise exception 'create_sim_assignment_atomic: target employee % is not active', p_employee_id;
  end if;

  -- Random secret name (not the email) -- same reasoning as
  -- admin_create_meta_dataset: the email is user-editable display data,
  -- the vault secret's own name should never need to change because of
  -- it.
  v_secret_id := vault.create_secret(
    p_email_password,
    'sim_email_' || gen_random_uuid()::text,
    'Company email password for: ' || v_email_address
  );

  insert into company_sim_assignments (sim_number, email_address, email_password_secret_id, created_by_employee_id)
  values (v_sim_number, v_email_address, v_secret_id, v_caller_id)
  returning id into v_sim_assignment_id;

  insert into sim_assignment_history (sim_assignment_id, employee_id, assigned_by_employee_id, reason, is_active)
  values (v_sim_assignment_id, p_employee_id, v_caller_id, v_reason, true);

  return v_sim_assignment_id;
end;
$function$;

-- delete_candidate_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.delete_candidate_atomic(p_candidate_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_paths text[];
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin') then
    raise exception 'delete_candidate_atomic: caller is not authorized';
  end if;

  if not exists (select 1 from candidates where id = p_candidate_id) then
    raise exception 'delete_candidate_atomic: candidate % not found', p_candidate_id;
  end if;

  select coalesce(array_agg(storage_path), array[]::text[])
  into v_paths
  from hr_documents
  where candidate_id = p_candidate_id;

  delete from hr_documents where candidate_id = p_candidate_id;
  delete from candidates where id = p_candidate_id; -- cascades candidate_interviews

  return v_paths;
end;
$function$;

-- delete_csv_batch_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.delete_csv_batch_atomic(p_batch_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_touched_count int;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin') then
    raise exception 'delete_csv_batch_atomic: caller is not an admin';
  end if;

  select count(*) into v_touched_count
  from leads l
  where l.csv_import_batch_id = p_batch_id
    and (
      l.board_stage is distinct from 'LEADS'
      or exists (
        select 1 from lead_history lh3
        where lh3.lead_id = l.id and lh3.outcome_at is not null
      )
      or (select count(*) from lead_history lh2 where lh2.lead_id = l.id) > 1
      or exists (
        select 1 from lead_notes ln
        join lead_history lh on lh.id = ln.lead_history_id
        where lh.lead_id = l.id
      )
      or exists (
        select 1 from site_visits sv where sv.lead_id = l.id
      )
    );

  if v_touched_count > 0 then
    raise exception 'delete_csv_batch_atomic: % lead(s) in this batch have already been worked on — cannot delete', v_touched_count;
  end if;

  delete from lead_notes ln
  using lead_history lh, leads l
  where ln.lead_history_id = lh.id
    and lh.lead_id = l.id
    and l.csv_import_batch_id = p_batch_id;

  delete from lead_history lh
  using leads l
  where lh.lead_id = l.id
    and l.csv_import_batch_id = p_batch_id;

  delete from lead_team_reservations ltr
  using leads l
  where ltr.lead_id = l.id
    and l.csv_import_batch_id = p_batch_id;

  delete from leads l
  where l.csv_import_batch_id = p_batch_id;

  update csv_import_batches
  set status = 'deleted'
  where id = p_batch_id;
end;
$function$;

-- deny_site_visit_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.deny_site_visit_atomic(p_site_visit_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_denier_id uuid;
  v_lead_id uuid;
  v_visit_employee_id uuid;
  v_current_owner_id uuid;
  v_active_history_id uuid;
  v_lead_name text;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin', 'sales_coordinator') then
    raise exception 'deny_site_visit_atomic: only Admin or Sales Coordinator can deny a visit';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'deny_site_visit_atomic: a reason is required to deny a visit';
  end if;
  v_denier_id := current_employee_id();
  select lead_id, employee_id
  into v_lead_id, v_visit_employee_id
  from site_visits
  where id = p_site_visit_id;
  if v_lead_id is null then
    raise exception 'deny_site_visit_atomic: site visit % not found', p_site_visit_id;
  end if;
  update site_visits
  set denied_at = now(), denied_by = v_denier_id, deny_reason = trim(p_reason)
  where id = p_site_visit_id and verified_at is null and denied_at is null;
  if not found then
    raise exception 'deny_site_visit_atomic: site visit % has already been verified or denied', p_site_visit_id;
  end if;
  select current_owner_id, name into v_current_owner_id, v_lead_name from leads where id = v_lead_id;
  if v_current_owner_id = v_visit_employee_id then
    select id into v_active_history_id
    from lead_history
    where lead_id = v_lead_id and employee_id = v_visit_employee_id and is_active = true;
    if v_active_history_id is not null then
      update leads
      set board_stage = 'FOLLOW_UP', board_stage_changed_at = now()
      where id = v_lead_id;
      update lead_history
      set
        paused_until = null,
        pause_reason = null,
        pause_note = null,
        pause_verified_by = null,
        pause_verified_at = null,
        last_activity_at = now(),
        sla_warning_sent_at = null,
        pause_expiry_warning_sent_at = null,
        pause_expired_notified_at = null
      where id = v_active_history_id;
      insert into notification (employee_id, employee_name, title, message, type, is_read)
      select
        v_visit_employee_id,
        e.name,
        'Visit not verified',
        format(
          'Your visit for %s was not verified — %s. The lead has been moved back to Follow-up.',
          coalesce(v_lead_name, 'a lead'),
          trim(p_reason)
        ),
        'VISIT_DENIED',
        false
      from employees e
      where e.id = v_visit_employee_id;
    end if;
  end if;
end;
$function$;

-- end_employee_leave_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.end_employee_leave_atomic(p_leave_id uuid, p_end_date date DEFAULT NULL::date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_start_date date;
  v_effective_end_date date;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin') then
    raise exception 'end_employee_leave_atomic: caller is not authorized';
  end if;

  select start_date into v_start_date from employee_leave_periods where id = p_leave_id;

  if v_start_date is null then
    raise exception 'end_employee_leave_atomic: leave period % not found', p_leave_id;
  end if;

  -- 2026-08-27 bug fix: "Mark Returned Today" (the only caller that
  -- omits p_end_date) means "not on leave as of right now" -- but
  -- end_date is INCLUSIVE everywhere this table is read
  -- (end_date >= today still counts as on-leave, correctly, for a
  -- real planned leave with a known return date). Setting end_date to
  -- TODAY therefore left the employee paused through the rest of
  -- today too -- exactly the bug reported. Defaulting to yesterday
  -- instead means today is immediately excluded. An explicit caller
  -- that DOES pass p_end_date (a real known return date, picked in
  -- the create-leave flow) keeps that inclusive meaning unchanged --
  -- only the "return today" default semantics were wrong, not the
  -- column's meaning itself.
  v_effective_end_date := coalesce(p_end_date, current_date - 1);

  if v_effective_end_date < v_start_date then
    -- Leave started today (or later) and is being closed today, the
    -- exact same day -- zero genuine leave days elapsed, so there's
    -- nothing meaningful to keep a row for. Deleting avoids both an
    -- inverted (end_date < start_date) row and a confusing validation
    -- error on what is, from Admin's side, a legitimate same-day
    -- "undo my mistake" click.
    delete from employee_leave_periods where id = p_leave_id;
    return;
  end if;

  update employee_leave_periods
  set end_date = v_effective_end_date
  where id = p_leave_id;
end;
$function$;

-- force_reassign_lead_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.force_reassign_lead_atomic(p_lead_id uuid, p_new_employee_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_id uuid;
  v_reason text;
  v_old_history_id uuid;
  v_old_employee_id uuid;
  v_status text;
  v_board_stage text;
  v_lead_type text;
  v_lead_name text;
  v_employee_name text;
  v_sla_minutes int;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin') then
    raise exception 'force_reassign_lead_atomic: caller is not an admin';
  end if;

  v_caller_id := current_employee_id();

  v_reason := nullif(trim(p_reason), '');
  if v_reason is null then
    raise exception 'force_reassign_lead_atomic: reason is required';
  end if;

  if not exists (select 1 from employees where id = p_new_employee_id and is_active = true) then
    raise exception 'force_reassign_lead_atomic: target employee % is not active', p_new_employee_id;
  end if;

  select id, employee_id into v_old_history_id, v_old_employee_id
  from lead_history
  where lead_id = p_lead_id and is_active = true;

  if v_old_history_id is null then
    raise exception 'force_reassign_lead_atomic: lead % has no active assignment', p_lead_id;
  end if;

  if v_old_employee_id = p_new_employee_id then
    raise exception 'force_reassign_lead_atomic: lead % is already assigned to that employee', p_lead_id;
  end if;

  update lead_history
  set is_active = false,
      ended_reason = 'ADMIN_REASSIGNED',
      reassign_note = v_reason
  where id = v_old_history_id and is_active = true;

  if not found then
    raise exception 'force_reassign_lead_atomic: lead_history % not found or already reassigned (concurrent reassign?)', v_old_history_id;
  end if;

  select status, board_stage, lead_type into v_status, v_board_stage, v_lead_type from leads where id = p_lead_id;

  if is_lead_terminal(v_status, v_board_stage) then
    update leads
    set current_owner_id = p_new_employee_id
    where id = p_lead_id and current_owner_id = v_old_employee_id
    returning name into v_lead_name;
  else
    select sla_first_contact_minutes into v_sla_minutes
    from lead_engine_settings
    where id = 1;

    if v_sla_minutes is null then
      raise exception 'force_reassign_lead_atomic: lead_engine_settings row not found';
    end if;

    update leads
    set current_owner_id = p_new_employee_id,
        status = 'NEW',
        board_stage = 'LEADS',
        board_stage_changed_at = now(),
        sla_deadline = compute_working_hours_sla_deadline(now(), v_sla_minutes)
    where id = p_lead_id and current_owner_id = v_old_employee_id
    returning name into v_lead_name;
  end if;

  if not found then
    raise exception 'force_reassign_lead_atomic: lead % ownership changed concurrently', p_lead_id;
  end if;

  insert into lead_history (lead_id, employee_id, assigned_at, is_active, call_count, assigned_by_type, assigned_by_employee_id, reassign_note)
  values (p_lead_id, p_new_employee_id, now(), true, 0, 'ADMIN', v_caller_id, v_reason);

  insert into lead_forced_removals (lead_id, removed_employee_id, removed_by, reason)
  values (p_lead_id, v_old_employee_id, v_caller_id, v_reason);

  select name into v_employee_name from employees where id = p_new_employee_id;
  insert into notification (employee_id, employee_name, title, message, type, is_read, related_lead_id)
  values (
    p_new_employee_id,
    coalesce(v_employee_name, ''),
    case when v_lead_type = 'DATA' then 'Data Reassigned to You' else 'Lead Reassigned to You' end,
    format('%s has been reassigned to you by an Administrator. Reason: %s', coalesce(v_lead_name, 'A lead'), v_reason),
    case when v_lead_type = 'DATA' then 'DATA_ASSIGNED' else 'LEAD_ASSIGNED' end,
    false,
    p_lead_id
  );
end;
$function$;

-- get_expense_detail_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.get_expense_detail_atomic(p_expense_id uuid)
 RETURNS TABLE(id uuid, expense_source text, amount numeric, expense_date date, description text, status text, rejection_reason text, employee_name text, submitted_by_name text, submitted_at timestamp with time zone, reviewed_by_name text, reviewed_at timestamp with time zone, paid_by_name text, paid_date date, payment_method text, payment_reference text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_employee_id uuid;
begin
  select e.employee_id into v_employee_id from expenses e where e.id = p_expense_id;

  if not found then
    raise exception 'get_expense_detail_atomic: expense % not found', p_expense_id;
  end if;

  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin', 'payroll') and current_employee_id() is distinct from v_employee_id then
    raise exception 'get_expense_detail_atomic: caller is not authorized';
  end if;

  return query
    select
      e.id, e.expense_source, e.amount, e.expense_date, e.description,
      e.status, e.rejection_reason,
      emp.name, sub.name, e.created_at,
      rev.name, e.reviewed_at,
      paidby.name, e.paid_date, e.payment_method, e.payment_reference
    from expenses e
    left join employees emp on emp.id = e.employee_id
    left join employees sub on sub.id = e.submitted_by_employee_id
    left join employees rev on rev.id = e.reviewed_by_employee_id
    left join employees paidby on paidby.id = e.paid_by_employee_id
    where e.id = p_expense_id;
end;
$function$;

-- get_hr_document_view_path_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.get_hr_document_view_path_atomic(p_document_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_id uuid;
  v_caller_role text;
  v_employee_id uuid;
  v_storage_path text;
begin
  v_caller_role := current_employee_role();
  v_caller_id := current_employee_id();

  if v_caller_id is null then
    raise exception 'get_hr_document_view_path_atomic: caller is not a recognized employee';
  end if;

  select employee_id, storage_path into v_employee_id, v_storage_path
  from hr_documents
  where id = p_document_id;

  if v_storage_path is null then
    raise exception 'get_hr_document_view_path_atomic: document % not found', p_document_id;
  end if;

  if coalesce(v_caller_role, '') not in ('admin', 'super_admin', 'hr') and v_employee_id <> v_caller_id then
    raise exception 'get_hr_document_view_path_atomic: caller is not authorized to view this document';
  end if;

  return v_storage_path;
end;
$function$;

-- get_lead_activity_log_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.get_lead_activity_log_atomic(p_lead_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_role text;
  v_calls json;
  v_activity json;
begin
  v_caller_role := current_employee_role();
  if coalesce(v_caller_role, '') not in ('admin', 'super_admin', 'sales_coordinator') then
    raise exception 'get_lead_activity_log_atomic: not authorized';
  end if;

  select coalesce(json_agg(json_build_object(
      'id', ccl.id,
      'clickType', ccl.click_type,
      'clickedAt', ccl.clicked_at,
      'employeeId', ccl.employee_id,
      'employeeName', e.name
    ) order by ccl.clicked_at), '[]'::json)
  into v_calls
  from contact_click_log ccl
  left join employees e on e.id = ccl.employee_id
  where ccl.lead_id = p_lead_id;

  select coalesce(json_agg(json_build_object(
      'id', lal.id,
      'activityType', lal.activity_type,
      'detail', lal.detail,
      'createdAt', lal.created_at,
      'employeeId', lal.employee_id,
      'employeeName', e.name
    ) order by lal.created_at), '[]'::json)
  into v_activity
  from lead_activity_log lal
  left join employees e on e.id = lal.employee_id
  where lal.lead_id = p_lead_id;

  return json_build_object('callClicks', v_calls, 'activityLog', v_activity);
end;
$function$;

-- get_sim_assignment_credentials_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.get_sim_assignment_credentials_atomic(p_sim_assignment_id uuid)
 RETURNS TABLE(sim_number text, email_address text, email_password text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin', 'hr') then
    raise exception 'get_sim_assignment_credentials_atomic: caller is not authorized';
  end if;

  return query
    select csa.sim_number, csa.email_address, vs.decrypted_secret
    from company_sim_assignments csa
    join vault.decrypted_secrets vs on vs.id = csa.email_password_secret_id
    where csa.id = p_sim_assignment_id;
end;
$function$;

-- get_stuck_leads_overview: 1 check(s)
CREATE OR REPLACE FUNCTION public.get_stuck_leads_overview()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_role text;
begin
  v_caller_role := current_employee_role();
  if coalesce(v_caller_role, '') not in ('admin', 'super_admin', 'sales_coordinator') then
    raise exception 'get_stuck_leads_overview: not authorized';
  end if;

  return coalesce(
    (
      select json_agg(
        json_build_object(
          'employeeId', e.id,
          'employeeName', e.name,
          'stuckCount', counts.stuck_count,
          'stuckLeads', counts.details
        )
        order by counts.stuck_count desc
      )
      from (
        select
          sl.employee_id,
          count(*) as stuck_count,
          json_agg(json_build_object(
            'leadName', sl.lead_name,
            'mobile', sl.mobile,
            'callCount', sl.call_count,
            'daysSinceLastAttempt', sl.days_since_last_attempt
          ) order by sl.days_since_last_attempt desc) as details
        from stuck_leads sl
        group by sl.employee_id
      ) counts
      join employees e on e.id = counts.employee_id
    ),
    '[]'::json
  );
end;
$function$;

-- give_advance_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.give_advance_atomic(p_employee_id uuid, p_amount numeric, p_given_date date, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_id uuid;
  v_reason text;
  v_advance_id uuid;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin', 'payroll') then
    raise exception 'give_advance_atomic: caller is not authorized';
  end if;

  v_caller_id := current_employee_id();
  v_reason := nullif(trim(p_reason), '');

  if p_amount is null or p_amount <= 0 then
    raise exception 'give_advance_atomic: amount must be greater than zero';
  end if;
  if v_reason is null then
    raise exception 'give_advance_atomic: reason is required';
  end if;
  if p_given_date is null then
    raise exception 'give_advance_atomic: given_date is required';
  end if;

  if not exists (select 1 from employees where id = p_employee_id and is_active = true) then
    raise exception 'give_advance_atomic: target employee % is not active', p_employee_id;
  end if;

  insert into employee_advances (employee_id, amount, given_date, reason, given_by_employee_id)
  values (p_employee_id, p_amount, p_given_date, v_reason, v_caller_id)
  returning id into v_advance_id;

  return v_advance_id;
end;
$function$;

-- log_booking_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.log_booking_atomic(p_lead_id uuid, p_points integer, p_target_employee_id uuid DEFAULT NULL::uuid, p_size text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_id uuid;
  v_employee_id uuid;
  v_employee_name text;
  v_lead_project text;
  v_size text;
  v_already_converted boolean;
  v_recipient record;
begin

  v_caller_id := current_employee_id();

  if v_caller_id is null then
    raise exception 'log_booking_atomic: caller is not a recognized employee';
  end if;

  -- p_target_employee_id (2026-08-22, Admin Manual-Booking-Entry):
  -- lets Admin log a booking attributed to a DIFFERENT employee than
  -- the caller (an existing lead someone else owns, or a retroactive
  -- manual record). Gated on role, not just on the param being
  -- present, so nobody can self-elevate. NULL -- every pre-existing
  -- call site (LeadDetailModal, DataDetailModal) never passes this --
  -- preserves the exact original behavior: caller always books their
  -- own lead.
  if p_target_employee_id is not null then
    if coalesce(current_employee_role(), '') not in ('admin', 'super_admin') then
      raise exception 'log_booking_atomic: only admin may log a booking for another employee';
    end if;
    v_employee_id := p_target_employee_id;
  else
    v_employee_id := v_caller_id;
  end if;

  if not exists (
    select 1 from leads
    where id = p_lead_id
      and current_owner_id = v_employee_id
  ) then
    raise exception 'log_booking_atomic: lead % is not owned by the calling employee', p_lead_id;
  end if;

  select (status = 'CONVERTED'), project
  into v_already_converted, v_lead_project
  from leads
  where id = p_lead_id;

  if v_already_converted then
    return;
  end if;

  if exists (
    select 1 from leads where id = p_lead_id and status = 'JUNK'
  ) then
    raise exception 'log_booking_atomic: lead % is JUNK, cannot be booked', p_lead_id;
  end if;

  insert into site_visits (lead_id, employee_id, event_type, points)
  values (p_lead_id, v_employee_id, 'BOOKED', p_points);

  update leads
  set status = 'CONVERTED', board_stage = 'BOOKING'
  where id = p_lead_id;

  -- Meta CAPI (2026-08-21): this function sets status='CONVERTED'
  -- directly, via its own path that never calls log_lead_update_atomic
  -- — so the CONVERTED/InitiateCheckout tier needs its own identical
  -- hook here too, or a lead moved straight to Booking (skipping the
  -- status dropdown) would silently never get this signal. Fires
  -- BEFORE the BOOKING/Purchase hook below — conceptually CONVERTED
  -- "happens" a moment earlier in the funnel, even though both are set
  -- in this same transaction. v_already_converted's early-return above
  -- guarantees this (like the BOOKING hook) only ever runs once.
  declare
    v_meta_lead_id text;
  begin
    select meta_lead_id into v_meta_lead_id from leads where id = p_lead_id;
    if v_meta_lead_id is not null then
      insert into meta_capi_events_log (lead_id, meta_lead_id, event_tier, meta_event_name)
      values (p_lead_id, v_meta_lead_id, 'CONVERTED', 'InitiateCheckout')
      on conflict (lead_id, event_tier) do nothing;
    end if;
  exception when others then
    perform log_anomaly('log_booking_atomic:meta_capi_enqueue', 'error', sqlerrm, jsonb_build_object('lead_id', p_lead_id));
  end;

  -- Meta CAPI (2026-08-19): BOOKING tier -> Purchase, the highest-
  -- value signal. Unconditional here -- the v_already_converted
  -- early-return above already guarantees this only ever runs once
  -- per genuine booking.
  declare
    v_meta_lead_id text;
  begin
    select meta_lead_id into v_meta_lead_id from leads where id = p_lead_id;
    if v_meta_lead_id is not null then
      insert into meta_capi_events_log (lead_id, meta_lead_id, event_tier, meta_event_name)
      values (p_lead_id, v_meta_lead_id, 'BOOKING', 'Purchase')
      on conflict (lead_id, event_tier) do nothing;
    end if;
  exception when others then
    perform log_anomaly('log_booking_atomic:meta_capi_enqueue', 'error', sqlerrm, jsonb_build_object('lead_id', p_lead_id));
  end;

  select name into v_employee_name from employees where id = v_employee_id;

  -- p_size (2026-08-22, Admin Manual-Booking-Entry Option B): appended
  -- to the celebration text only when present. Every real/Option-A
  -- booking passes NULL here, so their celebration message is
  -- byte-for-byte identical to before this change.
  v_size := nullif(trim(p_size), '');

  for v_recipient in select id, name from employees where is_active = true
  loop
    insert into notification (employee_id, employee_name, title, message, type, is_read)
    values (
      v_recipient.id,
      v_recipient.name,
      'Booking Celebration',
      format(
        '🎉 %s just closed a booking%s%s!',
        coalesce(v_employee_name, 'A team member'),
        case when v_lead_project is not null and v_lead_project <> '' then ' — ' || v_lead_project else '' end,
        case when v_size is not null then ' (' || v_size || ')' else '' end
      ),
      'BOOKING_CELEBRATION',
      false
    );
  end loop;

end;
$function$;

-- log_no_contact_remark_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.log_no_contact_remark_atomic(p_lead_history_id uuid, p_remark text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_id uuid;
  v_remark text;
  v_lead_id uuid;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin', 'sales_coordinator') then
    raise exception 'log_no_contact_remark_atomic: caller is not authorized';
  end if;
  v_caller_id := current_employee_id();
  if v_caller_id is null then
    raise exception 'log_no_contact_remark_atomic: caller is not a recognized employee';
  end if;
  v_remark := nullif(trim(p_remark), '');
  if v_remark is null then
    raise exception 'log_no_contact_remark_atomic: remark cannot be empty';
  end if;
  select lead_id into v_lead_id
  from lead_history
  where id = p_lead_history_id;
  if v_lead_id is null then
    raise exception 'log_no_contact_remark_atomic: lead_history % not found', p_lead_history_id;
  end if;
  insert into no_contact_click_remarks (lead_id, lead_history_id, remark, logged_by)
  values (v_lead_id, p_lead_history_id, v_remark, v_caller_id);
end;
$function$;

-- log_office_expense_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.log_office_expense_atomic(p_amount numeric, p_expense_date date, p_description text, p_receipt_storage_path text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_id uuid; v_description text; v_receipt_path text; v_expense_id uuid;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin', 'payroll') then
    raise exception 'log_office_expense_atomic: caller is not authorized';
  end if;
  v_caller_id := current_employee_id();

  v_description := nullif(trim(p_description), '');
  v_receipt_path := nullif(trim(p_receipt_storage_path), '');

  if p_amount is null or p_amount <= 0 then
    raise exception 'log_office_expense_atomic: amount must be greater than zero';
  end if;
  if v_description is null then
    raise exception 'log_office_expense_atomic: description is required';
  end if;
  if p_expense_date is null then
    raise exception 'log_office_expense_atomic: expense_date is required';
  end if;
  if v_receipt_path is null then
    raise exception 'log_office_expense_atomic: receipt upload is required for office expenses';
  end if;

  insert into expenses (expense_source, employee_id, amount, expense_date, description, receipt_storage_path, status, submitted_by_employee_id)
  values ('OFFICE_DIRECT', null, p_amount, p_expense_date, v_description, v_receipt_path, 'APPROVED', v_caller_id)
  returning id into v_expense_id;

  return v_expense_id;
end;
$function$;

-- make_legacy_lead: 1 check(s)
CREATE OR REPLACE FUNCTION public.make_legacy_lead(p_legacy_id uuid, p_project text DEFAULT NULL::text, p_confirm_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := current_employee_id();
  v_role text := coalesce(current_employee_role(), '');
  v_row legacy_numbers%rowtype;
  v_owner employees%rowtype;
  v_project text := nullif(trim(coalesce(p_project, '')), '');
  v_block text;
  v_token text;
  v_prev_token text;
  v_lead uuid;
  v_pointer uuid;
  v_restricted uuid;
begin
  if coalesce(v_role, '') not in ('admin', 'super_admin', 'sales_coordinator') then
    raise exception 'make_legacy_lead: caller is not authorized';
  end if;
  if v_project is not null and length(v_project) > 100 then
    raise exception 'make_legacy_lead: project name too long';
  end if;

  select * into v_row from legacy_numbers where id = p_legacy_id for update;
  if not found then
    raise exception 'make_legacy_lead: register entry not found';
  end if;
  select * into v_owner from employees where id = v_row.employee_id;

  v_block := case
    when v_row.converted_lead_id is not null then 'ALREADY_CONVERTED'
    when exists (select 1 from leads l where l.mobile_normalized = v_row.mobile_normalized and l.mobile not like 'MANUAL-%') then 'NUMBER_ALREADY_A_LEAD'
    when not coalesce(v_owner.is_active, false) then 'OWNER_INACTIVE'
  end;

  v_token := md5(p_legacy_id::text || '|' || coalesce(v_project, '') || '|' || v_caller::text || '|' || to_char(now(), 'YYYYMMDDHH24'));
  v_prev_token := md5(p_legacy_id::text || '|' || coalesce(v_project, '') || '|' || v_caller::text || '|' || to_char(now() - interval '1 hour', 'YYYYMMDDHH24'));

  if p_confirm_token is null then
    return jsonb_build_object(
      'mode', 'PREVIEW',
      'mobile_last4', right(v_row.mobile_normalized, 4),
      'owner_name', v_owner.name,
      'project', v_project,
      'blocked', v_block,
      'confirm_token', case when v_block is null then v_token end
    );
  end if;

  if p_confirm_token not in (v_token, v_prev_token) then
    raise exception 'make_legacy_lead: preview first (confirm token missing or expired)';
  end if;
  if v_block is not null then
    raise exception 'make_legacy_lead: %', v_block;
  end if;

  insert into leads (name, mobile, project, source, priority, lead_type, is_personal_lead, legacy_number_id)
  values ('Legacy client', v_row.mobile_normalized, v_project, 'Legacy', 'warm', 'LEAD', true, v_row.id)
  returning id into v_lead;

  select round_robin_pointer_employee_id, restricted_pool_pointer_employee_id
    into v_pointer, v_restricted
    from lead_engine_settings where id = 1;

  perform assign_lead_atomic(
    p_lead_id => v_lead,
    p_employee_id => v_row.employee_id,
    p_next_pointer_employee_id => v_pointer,
    p_next_restricted_pool_pointer_employee_id => v_restricted,
    p_assigned_by_type => case when v_role = 'sales_coordinator' then 'SALES_COORDINATOR' else 'ADMIN' end,
    p_assigned_by_employee_id => v_caller
  );

  update legacy_numbers set converted_lead_id = v_lead where id = v_row.id;

  insert into legacy_lead_conversions (legacy_number_id, lead_id, owner_employee_id, converted_by, mobile_last4, project)
  values (v_row.id, v_lead, v_row.employee_id, v_caller, right(v_row.mobile_normalized, 4), v_project);

  return jsonb_build_object('mode', 'CREATED', 'lead_id', v_lead, 'owner_name', v_owner.name, 'mobile_last4', right(v_row.mobile_normalized, 4));
end;
$function$;

-- mark_employee_leave_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.mark_employee_leave_atomic(p_employee_id uuid, p_start_date date, p_end_date date DEFAULT NULL::date, p_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_id uuid;
  v_leave_id uuid;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin') then
    raise exception 'mark_employee_leave_atomic: caller is not authorized';
  end if;

  v_caller_id := current_employee_id();
  if v_caller_id is null then
    raise exception 'mark_employee_leave_atomic: caller is not a recognized employee';
  end if;

  if not exists (select 1 from employees where id = p_employee_id and is_active = true) then
    raise exception 'mark_employee_leave_atomic: target employee % is not active', p_employee_id;
  end if;

  if p_end_date is not null and p_end_date < p_start_date then
    raise exception 'mark_employee_leave_atomic: end_date cannot be before start_date';
  end if;

  -- 2026-08-27 race-condition fix: the overlap-guard below is a plain
  -- SELECT EXISTS followed by an INSERT -- two truly-simultaneous
  -- calls for the same employee could both see "no active row" and
  -- both insert, before either commits. A SELECT...FOR UPDATE can't
  -- fix this (there's no existing row to lock -- the race is over the
  -- ABSENCE of one), and a partial unique index can't either (Postgres
  -- forbids current_date, a non-immutable function, in an index
  -- predicate, so it could only enforce "one open-ended row," not "no
  -- overlapping ranges" in general). A session-scoped advisory lock
  -- keyed on the employee id serializes this instead: the second
  -- concurrent call blocks HERE until the first transaction commits,
  -- then correctly sees the just-inserted row and hits the exists()
  -- check below for real, rather than racing past it. Transaction-
  -- scoped (_xact_), so it releases automatically on commit or
  -- rollback -- no separate unlock call needed.
  perform pg_advisory_xact_lock(hashtext(p_employee_id::text));

  -- Guard against two ambiguous "currently on leave" rows for the
  -- same employee — a currently-active period is one whose end_date
  -- is NULL (open-ended) or still in the future/today. Close or edit
  -- the existing one first (end_employee_leave_atomic, Piece 5)
  -- rather than layering a second one on top of it.
  if exists (
    select 1 from employee_leave_periods
    where employee_id = p_employee_id
      and (end_date is null or end_date >= current_date)
  ) then
    raise exception 'mark_employee_leave_atomic: employee % already has an active or open-ended leave period — close it before marking a new one', p_employee_id;
  end if;

  insert into employee_leave_periods (employee_id, start_date, end_date, reason, marked_by_employee_id)
  values (p_employee_id, p_start_date, p_end_date, nullif(trim(p_reason), ''), v_caller_id)
  returning id into v_leave_id;

  return v_leave_id;
end;
$function$;

-- mark_expense_paid_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.mark_expense_paid_atomic(p_expense_id uuid, p_paid_date date, p_payment_method text, p_payment_reference text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_id uuid; v_reference text; v_employee_id uuid; v_amount numeric;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin', 'payroll') then
    raise exception 'mark_expense_paid_atomic: caller is not authorized';
  end if;
  v_caller_id := current_employee_id();

  if p_payment_method not in ('CASH', 'UPI', 'BANK_TRANSFER', 'OTHER') then
    raise exception 'mark_expense_paid_atomic: invalid payment_method %', p_payment_method;
  end if;
  if p_paid_date is null then
    raise exception 'mark_expense_paid_atomic: paid_date is required';
  end if;

  v_reference := nullif(trim(p_payment_reference), '');
  if p_payment_method <> 'CASH' and v_reference is null then
    raise exception 'mark_expense_paid_atomic: payment_reference is required for %', p_payment_method;
  end if;

  select employee_id, amount into v_employee_id, v_amount
  from expenses
  where id = p_expense_id and status = 'APPROVED' and expense_source = 'EMPLOYEE_SUBMITTED';

  if v_employee_id is null then
    raise exception 'mark_expense_paid_atomic: expense % not found or not approved', p_expense_id;
  end if;

  update expenses
  set status = 'PAID', paid_date = p_paid_date, payment_method = p_payment_method,
      payment_reference = v_reference, paid_by_employee_id = v_caller_id
  where id = p_expense_id and status = 'APPROVED';

  if not found then
    raise exception 'mark_expense_paid_atomic: expense % was already changed concurrently', p_expense_id;
  end if;

  insert into notification (employee_id, employee_name, title, message, type, is_read)
  select v_employee_id, coalesce(e.name, ''),
    'Expense Paid',
    format('Your expense of %s has been paid via %s.', v_amount::text, p_payment_method),
    'EXPENSE_PAID', false
  from employees e where e.id = v_employee_id;
end;
$function$;

-- mark_hrms_attendance_manual_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.mark_hrms_attendance_manual_atomic(p_employee_id uuid, p_date date, p_status text, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_id uuid;
  v_reason text;
  v_office_lat double precision;
  v_office_lng double precision;
  v_first_half_start time;
  v_shift_start_at timestamptz;
  v_override_id uuid;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin', 'hr') then
    raise exception 'mark_hrms_attendance_manual_atomic: caller is not authorized';
  end if;

  v_caller_id := current_employee_id();

  if p_status not in ('PRESENT', 'ABSENT') then
    raise exception 'mark_hrms_attendance_manual_atomic: invalid status %', p_status;
  end if;

  v_reason := nullif(trim(p_reason), '');
  if v_reason is null then
    raise exception 'mark_hrms_attendance_manual_atomic: reason is required';
  end if;

  if not exists (select 1 from employees where id = p_employee_id and is_active = true) then
    raise exception 'mark_hrms_attendance_manual_atomic: target employee % is not active', p_employee_id;
  end if;

  if exists (select 1 from attendance where employee_id = p_employee_id and date = p_date) then
    raise exception 'mark_hrms_attendance_manual_atomic: an attendance record already exists for this employee on %', p_date;
  end if;

  if exists (select 1 from hrms_attendance_overrides where employee_id = p_employee_id and date = p_date) then
    raise exception 'mark_hrms_attendance_manual_atomic: this employee has already been manually marked for %', p_date;
  end if;

  -- PRESENT reuses the existing attendance table exactly as a real
  -- shift-start would shape it -- shift_start_at pinned to that date's
  -- configured office start time (IST), lat/lng set to the office's own
  -- configured coordinates (an honest assertion of presence, not a
  -- fabricated GPS reading), attendance_type='FULL_DAY'. This is the
  -- entire reason calculateDailyHrmsStatus needs zero changes: to it,
  -- this row is indistinguishable in shape from a real one, and
  -- naturally computes ON_TIME (office start time is always <= the
  -- on-time cutoff).
  if p_status = 'PRESENT' then
    select office_lat, office_lng, first_half_start_time
      into v_office_lat, v_office_lng, v_first_half_start
    from lead_engine_settings where id = 1;

    if v_office_lat is null or v_office_lng is null or v_first_half_start is null then
      raise exception 'mark_hrms_attendance_manual_atomic: office location/first_half_start_time not configured in lead_engine_settings';
    end if;

    v_shift_start_at := (p_date::text || ' ' || v_first_half_start::text)::timestamp at time zone 'Asia/Kolkata';

    insert into attendance (employee_id, date, shift_start_at, shift_start_lat, shift_start_lng, geofence_pass, attendance_type)
    values (p_employee_id, p_date, v_shift_start_at, v_office_lat, v_office_lng, true, 'FULL_DAY');
  end if;

  -- ABSENT touches nothing on `attendance` -- a missing row already
  -- means ABSENT in calculateDailyHrmsStatus. This insert is the only
  -- record of the decision either way.
  insert into hrms_attendance_overrides (employee_id, date, marked_status, marked_by_employee_id, reason)
  values (p_employee_id, p_date, p_status, v_caller_id, v_reason)
  returning id into v_override_id;

  return v_override_id;
end;
$function$;

-- reassign_project_leads_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.reassign_project_leads_atomic(p_project text, p_old_employee_id uuid, p_new_employee_id uuid, p_include_positive boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_id uuid;
  v_lead record;
  v_count int := 0;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin') then
    raise exception 'reassign_project_leads_atomic: caller is not an admin';
  end if;

  v_caller_id := current_employee_id();

  for v_lead in
    select l.id as lead_id, lh.id as lead_history_id
    from leads l
    join lead_history lh on lh.lead_id = l.id and lh.is_active = true
    where l.current_owner_id = p_old_employee_id
      and trim(lower(l.project)) = trim(lower(p_project))
      and (p_include_positive or not (
        l.board_stage in ('FOLLOW_UP', 'VISIT', 'BOOKING')
        or l.status in ('CONNECTED', 'CONVERTED')
        or coalesce(lh.pause_reason, '') in ('VISIT_LOCK', 'VISIT_PENDING_VERIFICATION')))
  loop
    update lead_history
    set is_active = false, ended_reason = 'ADMIN_REASSIGNED'
    where id = v_lead.lead_history_id;

    insert into lead_history (lead_id, employee_id, assigned_at, is_active, call_count, assigned_by_type, assigned_by_employee_id)
    values (v_lead.lead_id, p_new_employee_id, now(), true, 0, 'ADMIN', v_caller_id);

    update leads set current_owner_id = p_new_employee_id where id = v_lead.lead_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

-- register_hr_document_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.register_hr_document_atomic(p_employee_id uuid, p_document_type text, p_label text, p_storage_path text, p_file_mime_type text, p_is_generated boolean DEFAULT false, p_candidate_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_id uuid;
  v_label text;
  v_document_id uuid;
  v_employee_name text;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin', 'hr', 'payroll') then
    raise exception 'register_hr_document_atomic: caller is not authorized';
  end if;

  if (p_employee_id is null) = (p_candidate_id is null) then
    raise exception 'register_hr_document_atomic: exactly one of employee or candidate must be provided';
  end if;

  v_caller_id := current_employee_id();

  v_label := nullif(trim(p_label), '');
  if v_label is null then
    raise exception 'register_hr_document_atomic: label is required';
  end if;

  if p_document_type not in ('AADHAR', 'PAN', 'OFFER_LETTER', 'APPOINTMENT_LETTER', 'EXPERIENCE_LETTER', 'EDUCATIONAL', 'BOND', 'APPLICATION_FORM', 'JOINING_FORM', 'SALARY_SLIP', 'OTHER') then
    raise exception 'register_hr_document_atomic: invalid document type %', p_document_type;
  end if;

  if p_employee_id is not null then
    if not exists (select 1 from employees where id = p_employee_id and is_active = true) then
      raise exception 'register_hr_document_atomic: target employee % is not active', p_employee_id;
    end if;
  else
    if not exists (select 1 from candidates where id = p_candidate_id) then
      raise exception 'register_hr_document_atomic: candidate % not found', p_candidate_id;
    end if;
  end if;

  insert into hr_documents (employee_id, candidate_id, document_type, label, storage_path, file_mime_type, uploaded_by_employee_id, is_generated)
  values (p_employee_id, p_candidate_id, p_document_type, v_label, p_storage_path, p_file_mime_type, v_caller_id, p_is_generated)
  returning id into v_document_id;

  if p_employee_id is not null then
    select name into v_employee_name from employees where id = p_employee_id;

    insert into notification (employee_id, employee_name, title, message, type, is_read)
    values (
      p_employee_id,
      coalesce(v_employee_name, ''),
      'New Document Available',
      format('A new document (%s) has been added to your HR records.', v_label),
      'HR_DOCUMENT_UPLOADED',
      false
    );
  end if;

  return v_document_id;
end;
$function$;

-- reject_booking_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.reject_booking_atomic(p_request_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req booking_requests%rowtype;
  v_lead_name text;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin', 'sales_coordinator') then
    raise exception 'reject_booking_atomic: only Admin or Sales Coordinator can reject a booking';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reject_booking_atomic: a reason is required to reject a booking';
  end if;
  select * into v_req from booking_requests where id = p_request_id for update;
  if not found then
    raise exception 'reject_booking_atomic: booking request % not found', p_request_id;
  end if;
  if v_req.status <> 'PENDING' then
    raise exception 'reject_booking_atomic: this booking request was already %', lower(v_req.status);
  end if;

  update booking_requests
  set status = 'REJECTED', decided_by = current_employee_id(), decided_at = now(), reject_reason = trim(p_reason)
  where id = p_request_id;

  update lead_history
  set paused_until = v_req.prev_paused_until,
      pause_reason = v_req.prev_pause_reason,
      pause_note = v_req.prev_pause_note,
      pause_expiry_warning_sent_at = null,
      pause_expired_notified_at = null
  where lead_id = v_req.lead_id and employee_id = v_req.employee_id and is_active = true
    and pause_reason = 'VISIT_PENDING_VERIFICATION' and pause_note = 'Booking pending approval';

  select name into v_lead_name from leads where id = v_req.lead_id;
  insert into notification (employee_id, employee_name, title, message, type, is_read, related_lead_id)
  select e.id, e.name, 'Booking request not approved',
         format('Your booking request for %s was not approved — %s', coalesce(v_lead_name, 'a lead'), trim(p_reason)),
         'BOOKING_REJECTED', false, v_req.lead_id
  from employees e where e.id = v_req.employee_id;
end;
$function$;

-- reject_expense_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.reject_expense_atomic(p_expense_id uuid, p_rejection_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_id uuid; v_employee_id uuid; v_reason text;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin', 'payroll') then
    raise exception 'reject_expense_atomic: caller is not authorized';
  end if;
  v_caller_id := current_employee_id();
  v_reason := nullif(trim(p_rejection_reason), '');
  if v_reason is null then
    raise exception 'reject_expense_atomic: rejection_reason is required';
  end if;

  select employee_id into v_employee_id
  from expenses where id = p_expense_id and status = 'PENDING' and expense_source = 'EMPLOYEE_SUBMITTED';

  if v_employee_id is null then
    raise exception 'reject_expense_atomic: expense % not found or not pending', p_expense_id;
  end if;

  update expenses
  set status = 'REJECTED', reviewed_by_employee_id = v_caller_id, reviewed_at = now(), rejection_reason = v_reason
  where id = p_expense_id and status = 'PENDING';

  if not found then
    raise exception 'reject_expense_atomic: expense % was already decided concurrently', p_expense_id;
  end if;

  insert into notification (employee_id, employee_name, title, message, type, is_read)
  select v_employee_id, coalesce(e.name, ''),
    'Expense Rejected',
    format('Your expense was rejected: %s', v_reason),
    'EXPENSE_REJECTED', false
  from employees e where e.id = v_employee_id;
end;
$function$;

-- reject_lead_transfer_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.reject_lead_transfer_atomic(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin_id uuid;
  v_lead_id uuid;
  v_requested_by uuid;
  v_lead_name text;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin') then
    raise exception 'reject_lead_transfer_atomic: caller is not an admin';
  end if;
  v_admin_id := current_employee_id();

  update lead_transfer_requests
  set status = 'REJECTED',
      reviewed_by_admin_id = v_admin_id,
      reviewed_at = now(),
      updated_at = now()
  where id = p_request_id and status = 'PENDING'
  returning lead_id, requested_by_employee_id into v_lead_id, v_requested_by;

  if not found then
    raise exception 'reject_lead_transfer_atomic: request % not found or not pending', p_request_id;
  end if;

  select name into v_lead_name from leads where id = v_lead_id;
  insert into notification (employee_id, employee_name, title, message, type, is_read)
  select v_requested_by, coalesce(e.name, ''),
    'Transfer Request Rejected',
    format('Your transfer request for %s was rejected.', coalesce(v_lead_name, 'the lead')),
    'LEAD_TRANSFER_REJECTED', false
  from employees e where e.id = v_requested_by;
end;
$function$;

-- set_interview_result_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.set_interview_result_atomic(p_interview_id uuid, p_result text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_candidate_id uuid;
  v_current_status text;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin', 'hr') then
    raise exception 'set_interview_result_atomic: caller is not authorized';
  end if;

  if p_result not in ('PENDING', 'SELECTED', 'REJECTED', 'ON_HOLD') then
    raise exception 'set_interview_result_atomic: invalid result %', p_result;
  end if;

  select candidate_id into v_candidate_id from candidate_interviews where id = p_interview_id;
  if v_candidate_id is null then
    raise exception 'set_interview_result_atomic: interview % not found', p_interview_id;
  end if;

  update candidate_interviews set result = p_result where id = p_interview_id;

  select status into v_current_status from candidates where id = v_candidate_id;

  -- REJECTED always wins, at any stage -- a later round rejecting a
  -- candidate already marked SELECTED (or even after an offer went
  -- out) is a real scenario, not an edge case to guard against.
  if p_result = 'REJECTED' then
    update candidates set status = 'REJECTED' where id = v_candidate_id;
  -- SELECTED/ON_HOLD only move candidate.status while still in the
  -- pre-offer zone -- once an offer is out (or further), the most
  -- recent interview-round result is still recorded on the interview
  -- row itself, but doesn't retroactively change candidate.status.
  elsif v_current_status in ('APPLIED', 'INTERVIEWING', 'SELECTED', 'ON_HOLD') and p_result in ('SELECTED', 'ON_HOLD') then
    update candidates set status = p_result where id = v_candidate_id;
  end if;
end;
$function$;

-- transfer_sim_assignment_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.transfer_sim_assignment_atomic(p_sim_assignment_id uuid, p_new_employee_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_id uuid;
  v_reason text;
  v_old_history_id uuid;
  v_old_employee_id uuid;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin', 'hr') then
    raise exception 'transfer_sim_assignment_atomic: caller is not authorized';
  end if;

  v_caller_id := current_employee_id();

  v_reason := nullif(trim(p_reason), '');
  if v_reason is null then
    raise exception 'transfer_sim_assignment_atomic: reason is required';
  end if;

  if not exists (select 1 from company_sim_assignments where id = p_sim_assignment_id) then
    raise exception 'transfer_sim_assignment_atomic: sim assignment % not found', p_sim_assignment_id;
  end if;

  -- p_new_employee_id is deliberately nullable (the "drawer" case -- a
  -- SIM taken back from a departing employee with no new holder yet),
  -- but if it IS given, the target must be a real active employee, and
  -- must not already be the current holder (mirrors force_reassign_
  -- lead_atomic's identical "already assigned to that employee" guard).
  if p_new_employee_id is not null then
    if not exists (select 1 from employees where id = p_new_employee_id and is_active = true) then
      raise exception 'transfer_sim_assignment_atomic: target employee % is not active', p_new_employee_id;
    end if;

    if exists (
      select 1 from sim_assignment_history
      where sim_assignment_id = p_sim_assignment_id and is_active = true and employee_id = p_new_employee_id
    ) then
      raise exception 'transfer_sim_assignment_atomic: this sim assignment is already held by that employee';
    end if;
  end if;

  select id, employee_id into v_old_history_id, v_old_employee_id
  from sim_assignment_history
  where sim_assignment_id = p_sim_assignment_id and is_active = true;

  if v_old_history_id is null and p_new_employee_id is null then
    raise exception 'transfer_sim_assignment_atomic: this sim assignment has no current holder to unassign, and no new employee was given';
  end if;

  if v_old_history_id is not null then
    update sim_assignment_history
    set is_active = false, unassigned_at = now()
    where id = v_old_history_id and is_active = true;

    if not found then
      raise exception 'transfer_sim_assignment_atomic: sim assignment % holder changed concurrently', p_sim_assignment_id;
    end if;
  end if;

  if p_new_employee_id is not null then
    insert into sim_assignment_history (sim_assignment_id, employee_id, assigned_by_employee_id, reason, is_active)
    values (p_sim_assignment_id, p_new_employee_id, v_caller_id, v_reason, true);
  end if;

  update company_sim_assignments set updated_at = now() where id = p_sim_assignment_id;
end;
$function$;

-- unjunk_and_reassign_lead_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.unjunk_and_reassign_lead_atomic(p_lead_id uuid, p_new_employee_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_id uuid;
  v_reason text;
  v_status text;
  v_lead_type text;
  v_lead_name text;
  v_employee_name text;
  v_sla_minutes int;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin') then
    raise exception 'unjunk_and_reassign_lead_atomic: caller is not an admin';
  end if;

  v_caller_id := current_employee_id();

  v_reason := nullif(trim(p_reason), '');
  if v_reason is null then
    raise exception 'unjunk_and_reassign_lead_atomic: reason is required';
  end if;

  if not exists (select 1 from employees where id = p_new_employee_id and is_active = true) then
    raise exception 'unjunk_and_reassign_lead_atomic: target employee % is not active', p_new_employee_id;
  end if;

  select status, lead_type into v_status, v_lead_type from leads where id = p_lead_id;
  if v_status is null then
    raise exception 'unjunk_and_reassign_lead_atomic: lead % not found', p_lead_id;
  end if;
  if v_status <> 'JUNK' then
    raise exception 'unjunk_and_reassign_lead_atomic: lead % is not JUNK (status=%)', p_lead_id, v_status;
  end if;

  if v_lead_type <> 'DATA' then
    select sla_first_contact_minutes into v_sla_minutes from lead_engine_settings where id = 1;
    if v_sla_minutes is null then
      raise exception 'unjunk_and_reassign_lead_atomic: lead_engine_settings row not found';
    end if;
  end if;

  update leads
  set status = 'NEW',
      board_stage = 'LEADS',
      board_stage_changed_at = now(),
      current_owner_id = p_new_employee_id,
      recycle_count = 0,
      last_unjunked_at = now(),
      sla_deadline = case when v_lead_type = 'DATA' then null else compute_working_hours_sla_deadline(now(), v_sla_minutes) end
  where id = p_lead_id and status = 'JUNK'
  returning name into v_lead_name;

  if not found then
    raise exception 'unjunk_and_reassign_lead_atomic: lead % is not JUNK or was changed concurrently', p_lead_id;
  end if;

  insert into lead_history (lead_id, employee_id, assigned_at, is_active, call_count, assigned_by_type, assigned_by_employee_id, reassign_note)
  values (p_lead_id, p_new_employee_id, now(), true, 0, 'ADMIN', v_caller_id, v_reason);

  select name into v_employee_name from employees where id = p_new_employee_id;
  insert into notification (employee_id, employee_name, title, message, type, is_read, related_lead_id)
  values (
    p_new_employee_id,
    coalesce(v_employee_name, ''),
    case when v_lead_type = 'DATA' then 'Data Reassigned to You' else 'Lead Reassigned to You' end,
    format('%s has been reassigned to you by an Administrator (recovered from Junk). Reason: %s', coalesce(v_lead_name, 'A lead'), v_reason),
    case when v_lead_type = 'DATA' then 'DATA_ASSIGNED' else 'LEAD_ASSIGNED' end,
    false,
    p_lead_id
  );
end;
$function$;

-- verify_site_visit_atomic: 1 check(s)
CREATE OR REPLACE FUNCTION public.verify_site_visit_atomic(p_site_visit_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lead_id uuid;
  v_visit_employee_id uuid;
  v_visit_created_at timestamptz;
  v_current_owner_id uuid;
  v_active_history_id uuid;
  v_verifier_id uuid;
  v_lead_name text;
  v_new_paused_until timestamptz;
  v_current_paused_until timestamptz;
begin
  if coalesce(current_employee_role(), '') not in ('admin', 'super_admin', 'sales_coordinator') then
    raise exception 'verify_site_visit_atomic: only Admin or Sales Coordinator can verify a visit';
  end if;
  v_verifier_id := current_employee_id();
  select lead_id, employee_id, created_at
  into v_lead_id, v_visit_employee_id, v_visit_created_at
  from site_visits
  where id = p_site_visit_id;
  if v_lead_id is null then
    raise exception 'verify_site_visit_atomic: site visit % not found', p_site_visit_id;
  end if;
  update site_visits
  set verified_at = now(), verified_by = v_verifier_id
  where id = p_site_visit_id and verified_at is null and denied_at is null;
  if not found then
    raise exception 'verify_site_visit_atomic: site visit % has already been verified or denied', p_site_visit_id;
  end if;
  select current_owner_id into v_current_owner_id from leads where id = v_lead_id;
  select name into v_lead_name from leads where id = v_lead_id;
  if v_current_owner_id = v_visit_employee_id then
    select id, paused_until into v_active_history_id, v_current_paused_until
    from lead_history
    where lead_id = v_lead_id and employee_id = v_visit_employee_id and is_active = true;
    if v_active_history_id is not null then
      v_new_paused_until := v_visit_created_at + interval '1 month';
      if v_current_paused_until is null or v_current_paused_until < v_new_paused_until then
        update lead_history
        set
          paused_until = v_new_paused_until,
          pause_reason = 'VISIT_LOCK',
          pause_note = null,
          pause_verified_by = v_verifier_id,
          pause_verified_at = now(),
          last_activity_at = now(),
          pause_expiry_warning_sent_at = null,
          pause_expired_notified_at = null
        where id = v_active_history_id;
      else
        update lead_history
        set pause_verified_by = v_verifier_id, pause_verified_at = now()
        where id = v_active_history_id;
      end if;
      insert into notification (employee_id, employee_name, title, message, type, is_read)
      select
        v_visit_employee_id,
        e.name,
        'Visit verified',
        format(
          'Your visit for %s was verified — this lead is locked to you until %s.',
          coalesce(v_lead_name, 'a lead'),
          to_char(greatest(v_current_paused_until, v_new_paused_until), 'DD Mon YYYY')
        ),
        'VISIT_VERIFIED',
        false
      from employees e
      where e.id = v_visit_employee_id;
    end if;
  end if;
end;
$function$;

commit;
