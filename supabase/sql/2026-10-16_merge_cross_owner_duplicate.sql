-- 2026-10-16 — merge_cross_owner_duplicate (B1)
--
-- merge_duplicate_leads only merges a group with ONE owner. This merges
-- one duplicate copy (same number + same project) held by a DIFFERENT
-- employee into the copy that is kept, for an Admin-reviewed pair.
--
-- The kept lead is not changed at all (owner, status, stage, visit lock,
-- assignment). The removed copy ends like merge_duplicate_leads leaves it:
-- status JUNK + merged_into_lead_id, active assignment closed (JUNK), its
-- notes copied onto the kept lead (tagged), pending reminders switched off
-- on the original, unread notifications cleared. Its lead_history rows
-- (call_count) are untouched, so call credit stays with whoever made the
-- calls. One summary note goes on the kept lead, the removed owner gets a
-- LEAD_MERGED notification, and one lead_merge_audit row is written.
--
-- Refuses (no change) when: caller is not admin/super_admin; either lead
-- is already closed; numbers or projects differ; the removed copy has a
-- site visit, booking, pending booking request, pending transfer, team
-- reservation or is a personal lead; the kept lead has no active
-- assignment.

create or replace function public.merge_cross_owner_duplicate(
  p_keep_lead_id uuid,
  p_drop_lead_id uuid,
  p_kind text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller uuid := current_employee_id();
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
  if not coalesce((select is_admin()), false) then
    raise exception 'merge_cross_owner_duplicate: not authorized';
  end if;
  if p_kind not in ('VISIT', 'FOLLOW_UP', 'LEAD') then
    raise exception 'merge_cross_owner_duplicate: kind must be VISIT, FOLLOW_UP or LEAD';
  end if;
  if v_reason is null then
    raise exception 'merge_cross_owner_duplicate: reason is required';
  end if;
  if p_keep_lead_id = p_drop_lead_id then
    raise exception 'merge_cross_owner_duplicate: give two different leads';
  end if;

  -- Same lock order as merge_duplicate_leads (by id).
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
  values (v_caller, k.current_owner_id, k.project, right(k.mobile_normalized, 4), left(k.id::text, 8),
          array[left(d.id::text, 8)], v_notes, v_reminders,
          'Cross-owner duplicate (' || lower(p_kind) || '): ' || v_reason);

  return jsonb_build_object('mode', 'MERGED', 'keep_id8', left(k.id::text, 8), 'merged_id8', left(d.id::text, 8),
    'from_owner', v_drop_owner, 'to_owner', v_keep_owner, 'notes_copied', v_notes, 'reminders_moved', v_reminders);
end;
$function$;

revoke all on function public.merge_cross_owner_duplicate(uuid, uuid, text, text) from public, anon;
grant execute on function public.merge_cross_owner_duplicate(uuid, uuid, text, text) to authenticated;
