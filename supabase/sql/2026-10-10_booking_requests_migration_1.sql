-- RECORD ONLY. Applied manually to the live database on 2026-10-10 (after a BEGIN ... ROLLBACK test).
-- Do not re-run blindly; it is idempotent (create if not exists / create or replace), but check first.
-- Rollback: 2026-10-10_booking_requests_migration_1_rollback.sql

-- MIGRATION 1 (2026-10-10): booking request -> approval flow.
-- Adds a table and four functions. Changes NOTHING existing: log_booking_atomic,
-- Manual Booking Entry, admin direct booking and every recycle/SLA path are untouched.
-- While a request is pending the lead uses the existing Visit-pending pause
-- (pause_reason = 'VISIT_PENDING_VERIFICATION'), which recycle/SLA already respect
-- until a decision; the lead's previous pause is saved and restored on reject.

create table if not exists public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  lead_history_id uuid references public.lead_history(id),
  size text,
  note text,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.employees(id),
  decided_at timestamptz,
  reject_reason text,
  prev_paused_until timestamptz,
  prev_pause_reason text,
  prev_pause_note text
);
create unique index if not exists booking_requests_one_pending_per_lead on public.booking_requests (lead_id) where status = 'PENDING';
create index if not exists booking_requests_status_requested_idx on public.booking_requests (status, requested_at desc);

alter table public.booking_requests enable row level security;
drop policy if exists booking_requests_admin_all on public.booking_requests;
create policy booking_requests_admin_all on public.booking_requests for all using ((select is_admin())) with check ((select is_admin()));
drop policy if exists booking_requests_employee_select_own on public.booking_requests;
create policy booking_requests_employee_select_own on public.booking_requests for select using (employee_id = (select current_employee_id()));
drop policy if exists booking_requests_sales_coordinator_select on public.booking_requests;
create policy booking_requests_sales_coordinator_select on public.booking_requests for select using ((select current_employee_role()) = 'sales_coordinator');

-- The booking itself, unchanged from log_booking_atomic's body (BOOKED row, CONVERTED +
-- BOOKING, Meta CAPI, celebration) plus board_stage_changed_at. Internal only.
create or replace function public.book_lead_internal(p_lead_id uuid, p_employee_id uuid, p_points integer, p_size text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_employee_name text;
  v_lead_project text;
  v_size text;
  v_recipient record;
  v_meta_lead_id text;
begin
  select project, meta_lead_id into v_lead_project, v_meta_lead_id from leads where id = p_lead_id;

  insert into site_visits (lead_id, employee_id, event_type, points)
  values (p_lead_id, p_employee_id, 'BOOKED', p_points);

  update leads
  set status = 'CONVERTED', board_stage = 'BOOKING', board_stage_changed_at = now()
  where id = p_lead_id;

  if v_meta_lead_id is not null then
    begin
      insert into meta_capi_events_log (lead_id, meta_lead_id, event_tier, meta_event_name)
      values (p_lead_id, v_meta_lead_id, 'CONVERTED', 'InitiateCheckout')
      on conflict (lead_id, event_tier) do nothing;
      insert into meta_capi_events_log (lead_id, meta_lead_id, event_tier, meta_event_name)
      values (p_lead_id, v_meta_lead_id, 'BOOKING', 'Purchase')
      on conflict (lead_id, event_tier) do nothing;
    exception when others then
      perform log_anomaly('book_lead_internal:meta_capi_enqueue', 'error', sqlerrm, jsonb_build_object('lead_id', p_lead_id));
    end;
  end if;

  select name into v_employee_name from employees where id = p_employee_id;
  v_size := nullif(trim(p_size), '');
  for v_recipient in select id, name from employees where is_active = true loop
    insert into notification (employee_id, employee_name, title, message, type, is_read)
    values (
      v_recipient.id, v_recipient.name, 'Booking Celebration',
      format('🎉 %s just closed a booking%s%s!',
        coalesce(v_employee_name, 'A team member'),
        case when v_lead_project is not null and v_lead_project <> '' then ' — ' || v_lead_project else '' end,
        case when v_size is not null then ' (' || v_size || ')' else '' end),
      'BOOKING_CELEBRATION', false);
  end loop;
end;
$function$;
revoke all on function public.book_lead_internal(uuid, uuid, integer, text) from public, anon, authenticated;

-- Employee (owner) asks for a booking. The lead does not move; it is paused like a pending visit.
create or replace function public.request_booking_atomic(p_lead_id uuid, p_size text default null, p_note text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare
  v_employee_id uuid := current_employee_id();
  v_employee_name text;
  v_status text;
  v_stage text;
  v_project text;
  v_history record;
  v_request_id uuid;
begin
  if v_employee_id is null then
    raise exception 'request_booking_atomic: caller is not a recognized employee';
  end if;
  select status, board_stage, project into v_status, v_stage, v_project
    from leads where id = p_lead_id and current_owner_id = v_employee_id;
  if not found then
    raise exception 'request_booking_atomic: lead % is not owned by the calling employee', p_lead_id;
  end if;
  if is_lead_terminal(v_status, v_stage) then
    raise exception 'request_booking_atomic: lead % is already closed or junk', p_lead_id;
  end if;
  if exists (select 1 from booking_requests where lead_id = p_lead_id and status = 'PENDING') then
    raise exception 'request_booking_atomic: a booking request for this lead is already pending';
  end if;

  select id, paused_until, pause_reason, pause_note into v_history
    from lead_history where lead_id = p_lead_id and employee_id = v_employee_id and is_active = true;

  insert into booking_requests (lead_id, employee_id, lead_history_id, size, note, prev_paused_until, prev_pause_reason, prev_pause_note)
  values (p_lead_id, v_employee_id, v_history.id, nullif(trim(p_size), ''), nullif(trim(p_note), ''),
          v_history.paused_until, v_history.pause_reason, v_history.pause_note)
  returning id into v_request_id;

  -- Same pause a logged visit gets: holds the lead (no recycle / SLA) until a decision.
  if v_history.id is not null then
    update lead_history
    set last_activity_at = now(),
        paused_until = now() + interval '3 days',
        pause_reason = 'VISIT_PENDING_VERIFICATION',
        pause_note = 'Booking pending approval',
        pause_verified_by = null,
        pause_verified_at = null,
        sla_warning_sent_at = null,
        pause_expiry_warning_sent_at = null,
        pause_expired_notified_at = null
    where id = v_history.id;
  end if;

  select name into v_employee_name from employees where id = v_employee_id;
  insert into notification (employee_id, employee_name, title, message, type, is_read, related_lead_id)
  select e.id, e.name, 'Booking request',
         format('%s requested a booking%s — approve or reject it in Booking requests.',
                coalesce(v_employee_name, 'An employee'),
                case when v_project is not null and v_project <> '' then ' for ' || v_project else '' end),
         'BOOKING_REQUESTED', false, p_lead_id
  from employees e
  where e.is_active = true and e.role in ('admin', 'super_admin', 'sales_coordinator');

  return v_request_id;
end;
$function$;

-- Admin / Super Admin / Sales Coordinator approves: the booking happens now, for the requester.
create or replace function public.approve_booking_atomic(p_request_id uuid, p_points integer)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_req booking_requests%rowtype;
  v_status text;
  v_stage text;
  v_owner uuid;
  v_lead_name text;
begin
  if current_employee_role() not in ('admin', 'super_admin', 'sales_coordinator') then
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

-- Reject with a reason: the lead stays where it was, its previous pause comes back.
create or replace function public.reject_booking_atomic(p_request_id uuid, p_reason text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_req booking_requests%rowtype;
  v_lead_name text;
begin
  if current_employee_role() not in ('admin', 'super_admin', 'sales_coordinator') then
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

revoke all on function public.request_booking_atomic(uuid, text, text) from public, anon;
revoke all on function public.approve_booking_atomic(uuid, integer) from public, anon;
revoke all on function public.reject_booking_atomic(uuid, text) from public, anon;
grant execute on function public.request_booking_atomic(uuid, text, text) to authenticated;
grant execute on function public.approve_booking_atomic(uuid, integer) to authenticated;
grant execute on function public.reject_booking_atomic(uuid, text) to authenticated;
