-- 2026-10-17 — G1 / G3 / G4: positive leads stay with the person working them. NOT APPLIED.
-- Apply only after an explicit "haan". Rollback: 2026-10-17_g1_g3_g4_positive_leads_rollback.sql
--
-- "Positive" (same as lib/positiveLead.ts): stage FOLLOW_UP / VISIT / BOOKING, or status
-- CONNECTED / CONVERTED, or an active VISIT_LOCK / VISIT_PENDING_VERIFICATION pause.
--
-- G1  recycle sibling guard: settings column recycle_sibling_guard_mode (default 'shadow'),
--     get_positive_number_holders() for recycle-stale-leads (one jsonb value per sweep, no
--     row cap), and merge_recycled_copy_into_holder() — the B1 cross-owner merge, callable
--     by the sweep (service_role). The merge logic moves into merge_cross_owner_core() so
--     the admin function and the sweep share one implementation.
-- G3  distribution_guard_holder() uses the same positive definition (adds BOOKING stage and
--     CONNECTED / CONVERTED status). Still shadow: it only logs.
-- G4  reassign_project_leads_atomic() leaves positive leads with the current owner unless
--     p_include_positive = true; count_project_reassign_leads() gives the UI its counts.

begin;

-- G1 settings -----------------------------------------------------------------
alter table lead_engine_settings
  add column if not exists recycle_sibling_guard_mode text not null default 'shadow'
    check (recycle_sibling_guard_mode in ('off', 'shadow', 'enforce'));

-- Shared positive definition ----------------------------------------------------
create or replace function public.positive_number_holders()
returns table (lead_id uuid, mobile text, project_key text, owner_id uuid, owner_active boolean, rank int, stage_label text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select l.id, l.mobile_normalized, lower(btrim(coalesce(l.project, ''))), l.current_owner_id, coalesce(e.is_active, false),
    case when l.board_stage = 'VISIT' or h.pause_reason in ('VISIT_LOCK', 'VISIT_PENDING_VERIFICATION') then 1
         when l.board_stage = 'BOOKING' then 2
         when l.board_stage = 'FOLLOW_UP' then 3
         else 4 end,
    case when h.pause_reason in ('VISIT_LOCK', 'VISIT_PENDING_VERIFICATION') then 'VISIT'
         when l.board_stage in ('FOLLOW_UP', 'VISIT', 'BOOKING') then l.board_stage
         else l.status end
  from leads l
  left join employees e on e.id = l.current_owner_id
  left join lead_history h on h.lead_id = l.id and h.is_active
  where l.status <> 'JUNK'
    and l.merged_into_lead_id is null
    and l.current_owner_id is not null
    and l.mobile_normalized ~ '^[0-9]{10}$'
    and (l.board_stage in ('FOLLOW_UP', 'VISIT', 'BOOKING')
         or l.status in ('CONNECTED', 'CONVERTED')
         or h.pause_reason in ('VISIT_LOCK', 'VISIT_PENDING_VERIFICATION'));
$function$;

create or replace function public.get_positive_number_holders()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'lead_id', lead_id, 'mobile', mobile, 'project_key', project_key,
    'owner_id', owner_id, 'owner_active', owner_active, 'rank', rank)), '[]'::jsonb)
  from positive_number_holders();
$function$;

-- G3: Distribution Guard uses the shared definition (shadow trigger unchanged) -----
create or replace function public.distribution_guard_holder(p_lead_id uuid, p_mobile_normalized text)
returns table (holder_lead_id uuid, holder_owner_id uuid, holder_stage text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p.lead_id, p.owner_id, p.stage_label
  from positive_number_holders() p
  where p_mobile_normalized ~ '^[0-9]{10}$'
    and p.mobile = p_mobile_normalized
    and p.lead_id <> p_lead_id
    and p.owner_active
  order by p.rank, p.lead_id
  limit 1;
$function$;

-- G1: one merge implementation, two callers ----------------------------------------
create or replace function public.merge_cross_owner_core(
  p_keep_lead_id uuid, p_drop_lead_id uuid, p_kind text, p_reason text, p_by uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  k leads%rowtype;
  d leads%rowtype;
  v_keep_hid uuid;
  v_keep_owner text;
  v_drop_owner text;
  v_calls int;
  v_outcome text;
  v_next text;
  v_notes int;
  v_reminders int;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if p_kind not in ('VISIT', 'FOLLOW_UP', 'LEAD') then
    raise exception 'merge_cross_owner_duplicate: kind must be VISIT, FOLLOW_UP or LEAD';
  end if;
  if v_reason is null then
    raise exception 'merge_cross_owner_duplicate: reason is required';
  end if;
  if p_keep_lead_id = p_drop_lead_id then
    raise exception 'merge_cross_owner_duplicate: give two different leads';
  end if;

  perform 1 from leads where id in (p_keep_lead_id, p_drop_lead_id) order by id for update;
  select * into k from leads where id = p_keep_lead_id;
  select * into d from leads where id = p_drop_lead_id;
  if k.id is null or d.id is null then
    raise exception 'merge_cross_owner_duplicate: lead not found';
  end if;
  if k.status = 'JUNK' or k.merged_into_lead_id is not null then
    raise exception 'merge_cross_owner_duplicate: the kept lead % is closed', left(k.id::text, 8);
  end if;
  if d.status = 'JUNK' or d.merged_into_lead_id is not null then
    raise exception 'merge_cross_owner_duplicate: % is already closed', left(d.id::text, 8);
  end if;
  if k.mobile_normalized is null or k.mobile_normalized is distinct from d.mobile_normalized then
    raise exception 'merge_cross_owner_duplicate: different numbers';
  end if;
  if lower(btrim(coalesce(k.project, ''))) <> lower(btrim(coalesce(d.project, ''))) then
    raise exception 'merge_cross_owner_duplicate: different projects — not a duplicate';
  end if;
  if coalesce(d.is_personal_lead, false) then
    raise exception 'merge_cross_owner_duplicate: % is a personal lead — manual review', left(d.id::text, 8);
  end if;
  if d.board_stage = 'BOOKING'
     or exists (select 1 from site_visits where lead_id = d.id)
     or exists (select 1 from bookings where lead_id = d.id)
     or exists (select 1 from booking_requests where lead_id = d.id and status = 'PENDING')
     or exists (select 1 from lead_transfer_requests where lead_id = d.id and status = 'PENDING')
     or exists (select 1 from lead_team_reservations where lead_id = d.id) then
    raise exception 'merge_cross_owner_duplicate: % has a visit, booking, transfer or team reservation — manual review', left(d.id::text, 8);
  end if;

  select id into v_keep_hid from lead_history where lead_id = k.id and is_active;
  if v_keep_hid is null then
    raise exception 'merge_cross_owner_duplicate: the kept lead has no active assignment';
  end if;

  select name into v_keep_owner from employees where id = k.current_owner_id;
  select name into v_drop_owner from employees where id = d.current_owner_id;
  select coalesce(sum(call_count), 0) into v_calls from lead_history where lead_id = d.id;
  select detail into v_outcome from lead_activity_log
    where lead_id = d.id and activity_type = 'STATUS_UPDATE' order by created_at desc limit 1;
  select to_char(min(reminder_at) at time zone 'Asia/Kolkata', 'DD Mon HH24:MI') into v_next
    from lead_notes where lead_id = d.id and reminder_at > now();
  select count(*) into v_notes from lead_notes where lead_id = d.id;
  select count(*) into v_reminders from lead_notes
    where lead_id = d.id and reminder_at is not null and reminder_notified_at is null;

  insert into lead_notes (lead_id, lead_history_id, employee_id, note)
  values (k.id, v_keep_hid, d.current_owner_id,
    format('[Merged duplicate %s] Owner %s, calls %s, last outcome %s, follow-up %s', left(d.id::text, 8),
      coalesce(v_drop_owner, '-'), v_calls, coalesce(v_outcome, 'none'), coalesce(v_next, 'none')));

  insert into lead_notes (lead_id, lead_history_id, employee_id, note, created_at, reminder_at, reminder_notified_at)
  select k.id, v_keep_hid, n.employee_id, '[Merged from duplicate ' || left(n.lead_id::text, 8) || '] ' || n.note,
         n.created_at, n.reminder_at, n.reminder_notified_at
  from lead_notes n where n.lead_id = d.id;
  update lead_notes set reminder_notified_at = now()
  where lead_id = d.id and reminder_at is not null and reminder_notified_at is null;

  update lead_history set is_active = false, ended_reason = 'JUNK' where lead_id = d.id and is_active;
  update leads set status = 'JUNK', merged_into_lead_id = k.id, merged_at = now() where id = d.id;
  update notification set is_read = true, read_at = now() where related_lead_id = d.id and not is_read;

  if d.current_owner_id is distinct from k.current_owner_id then
    insert into notification (employee_id, employee_name, title, message, type, is_read, related_lead_id)
    values (d.current_owner_id, coalesce(v_drop_owner, ''), 'Duplicate lead merged',
      case when p_kind = 'VISIT'
        then format('This client already had a site visit with %s, so your duplicate copy was merged.', coalesce(v_keep_owner, 'a colleague'))
        else format('This client is already being followed up by %s, so your duplicate copy was merged.', coalesce(v_keep_owner, 'a colleague')) end,
      'LEAD_MERGED', false, k.id);
  end if;

  insert into lead_merge_audit (merged_by, owner_employee_id, project, mobile_last4, kept_id8, merged_id8s, notes_copied, reminders_moved, reason)
  values (p_by, k.current_owner_id, k.project, right(k.mobile_normalized, 4), left(k.id::text, 8),
          array[left(d.id::text, 8)], v_notes, v_reminders,
          'Cross-owner duplicate (' || lower(p_kind) || '): ' || v_reason);

  return jsonb_build_object('mode', 'MERGED', 'keep_id8', left(k.id::text, 8), 'merged_id8', left(d.id::text, 8),
    'from_owner', v_drop_owner, 'to_owner', v_keep_owner, 'notes_copied', v_notes, 'reminders_moved', v_reminders);
end;
$function$;

-- Admin entry point: unchanged behavior, now a thin wrapper.
create or replace function public.merge_cross_owner_duplicate(
  p_keep_lead_id uuid, p_drop_lead_id uuid, p_kind text, p_reason text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not coalesce((select is_admin()), false) then
    raise exception 'merge_cross_owner_duplicate: not authorized';
  end if;
  return merge_cross_owner_core(p_keep_lead_id, p_drop_lead_id, p_kind, p_reason, current_employee_id());
end;
$function$;

-- Sweep entry point (recycle-stale-leads, service_role only).
create or replace function public.merge_recycled_copy_into_holder(p_keep_lead_id uuid, p_drop_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'merge_recycled_copy_into_holder: only the recycle sweep may call this';
  end if;
  return merge_cross_owner_core(p_keep_lead_id, p_drop_lead_id, 'LEAD',
    'recycle sibling guard: stale copy merged into the positive lead', null);
end;
$function$;

revoke all on function public.positive_number_holders() from public, anon, authenticated;
revoke all on function public.get_positive_number_holders() from public, anon, authenticated;
revoke all on function public.merge_cross_owner_core(uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.merge_recycled_copy_into_holder(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_positive_number_holders() to service_role;
grant execute on function public.merge_recycled_copy_into_holder(uuid, uuid) to service_role;

-- G4: admin project reassign leaves positive leads unless asked ---------------------
drop function if exists public.reassign_project_leads_atomic(text, uuid, uuid);

create or replace function public.reassign_project_leads_atomic(
  p_project text, p_old_employee_id uuid, p_new_employee_id uuid, p_include_positive boolean default false
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_id uuid;
  v_lead record;
  v_count int := 0;
begin
  if current_employee_role() not in ('admin', 'super_admin') then
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

create or replace function public.count_project_reassign_leads(p_project text, p_old_employee_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if current_employee_role() not in ('admin', 'super_admin') then
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

revoke all on function public.reassign_project_leads_atomic(text, uuid, uuid, boolean) from public, anon;
grant execute on function public.reassign_project_leads_atomic(text, uuid, uuid, boolean) to authenticated;
revoke all on function public.count_project_reassign_leads(text, uuid) from public, anon;
grant execute on function public.count_project_reassign_leads(text, uuid) to authenticated;

commit;
