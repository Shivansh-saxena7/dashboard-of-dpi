-- DRAFT, NOT APPLIED (2026-11-28, feature/lead-full-history). Apply only on the owner's "haan", from an LF copy
-- (git cat-file -p), CR count 0, rolled-back dry run first, at least 2 minutes away from a sweep (:00/:15/:30/:45 IST)
-- and the perf refresh (:37 IST).
-- Why: the admin History modal was not the whole story. Its site_visits and lead_snooze_log reads embed employees(name)
-- while those tables have 3 and 2 foreign keys to employees, so PostgREST refuses them as ambiguous and the modal drops
-- the error silently (no visits, no snoozes). It also never showed restores, admin batches (reason / label), guard
-- events (junk, holds, refused recycles), transfer requests, the owner's leave or how each owner got the lead.
-- This read-only function returns ONE lead's full journey, start to end, for any lead (junk, restored, recycled,
-- merged), in one call:
--   lead      the lead's current state (no name / mobile: those come only from get_admin_lead_contacts)
--   stints    every assignment in order. Built on the Performance Report's own engine: get_lead_journey (origin FRESH /
--             RECYCLED / RESTORED / ADMIN_GIVEN / SELF / OTHER, ended_at, and perf_stint_facts) plus the lead_history
--             row (how it ended, calls, outcome, pause, recycle reason, admin note) and the admin batches
--             (get_lead_report_batches). employee_sees is what the employee was shown for that assignment.
--   events    every status / stage move, admin reassign / restore, call / WhatsApp click, note, visit / booking,
--             snooze, restore, guard event (junk, hold, refused recycle), transfer request, team reservation and the
--             owner's leave that overlapped their assignment. Each category at most 2000 rows (truncated flag).
--   * SECURITY DEFINER, search_path pinned, refuses everyone except is_admin() (active admin / super_admin): 42501.
--   * One lead per call (p_lead_id required, else 22023). EXECUTE revoked from PUBLIC and anon, granted to
--     authenticated only. No table grant, policy or existing function changes.
-- Rollback: 2026-11-29_admin_lead_full_journey_rollback.sql.
begin;

create or replace function public.get_admin_lead_full_journey(p_lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lead jsonb;
  v_journey jsonb;
  v_batches jsonb;
  v_stints jsonb;
  v_events jsonb;
  v_cap constant int := 2000;
  v_truncated boolean := false;
begin
  if not coalesce((select public.is_admin()), false) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_lead_id is null then
    raise exception 'p_lead_id is required' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'id', l.id, 'id8', left(l.id::text, 8), 'lead_type', coalesce(l.lead_type, 'LEAD'), 'status', l.status, 'board_stage', l.board_stage,
    'project', l.project, 'source', l.source, 'catcher_name', l.catcher_name, 'is_personal_lead', l.is_personal_lead,
    'created_at', l.created_at, 'updated_at', l.updated_at, 'recycle_count', l.recycle_count, 'last_unjunked_at', l.last_unjunked_at,
    'board_stage_changed_at', l.board_stage_changed_at, 'current_owner_id', l.current_owner_id, 'current_owner_name', co.name,
    'pending_team_name', pt.name, 'merged_into8', left(l.merged_into_lead_id::text, 8), 'merged_at', l.merged_at,
    'csv_batch8', left(l.csv_import_batch_id::text, 8), 'csv_batch_file', cb.filename)
  into v_lead
  from leads l
  left join employees co on co.id = l.current_owner_id
  left join teams pt on pt.id = l.pending_team_id
  left join csv_import_batches cb on cb.id = l.csv_import_batch_id
  where l.id = p_lead_id;

  if v_lead is null then
    return jsonb_build_object('found', false, 'lead_id', p_lead_id);
  end if;

  -- The Performance Report's own per-lead engine (same origin rule and facts as the Lead Journey tab).
  v_journey := public.get_lead_journey(p_lead_id);
  v_batches := coalesce(public.get_lead_report_batches(p_lead_id) -> 'batches', '[]'::jsonb);

  select coalesce(jsonb_agg(
    s || jsonb_build_object(
      'assigned_by_type', h.assigned_by_type,
      'assigned_by_name', ab.name,
      'reassign_note', h.reassign_note,
      'ended_reason', h.ended_reason,
      'outcome', h.outcome, 'outcome_at', h.outcome_at,
      'call_count', h.call_count, 'first_call_at', h.first_call_at, 'first_whatsapp_at', h.first_whatsapp_at,
      'last_activity_at', h.last_activity_at,
      'recycle_reason', h.recycle_reason, 'recycled_from_status', h.recycled_from_status, 'recycled_from_stage', h.recycled_from_stage,
      'paused_until', h.paused_until, 'pause_reason', h.pause_reason, 'pause_note', h.pause_note,
      'restore', (select jsonb_build_object('restored_at', r.restored_at, 'by_name', rb.name, 'reason', r.reason, 'highest_positive', r.highest_positive,
                    'restored_status', r.restored_status, 'restored_stage', r.restored_stage, 'protected_until', r.protected_until,
                    'undone_at', r.undone_at, 'undone_note', r.undone_note)
                  from lead_restore_log r left join employees rb on rb.id = r.restored_by
                  where r.new_lead_history_id = h.id order by r.restored_at desc limit 1),
      'batch', (select b from jsonb_array_elements(v_batches) b where b ->> 'new_stint_id' = h.id::text limit 1),
      -- What the employee was shown for this assignment (the Leads card / given-lead banner), not the admin's reason.
      'employee_sees', case
          when s ->> 'origin' = 'SELF' then 'Own lead (added by them)'
          when s ->> 'origin' = 'FRESH' then 'New lead'
          when s ->> 'origin' = 'RECYCLED' then 'Recycled lead'
          when s ->> 'origin' = 'RESTORED' then 'Given by admin (protected)'
          when s ->> 'origin' = 'ADMIN_GIVEN' then 'Given by admin'
          else 'Assigned' end
    ) order by h.assigned_at, h.id), '[]'::jsonb)
  into v_stints
  from jsonb_array_elements(coalesce(v_journey -> 'stints', '[]'::jsonb)) s
  join lead_history h on h.id = (s ->> 'stint_id')::uuid
  left join employees ab on ab.id = h.assigned_by_employee_id;

  with ev as (
    (select a.created_at at, case a.activity_type when 'STATUS_UPDATE' then 'STATUS' when 'BOARD_STAGE_MOVE' then 'STAGE' else a.activity_type end kind,
            a.detail, a.employee_id, a.lead_history_id stint_id, null::text text, null::jsonb extra
       from lead_activity_log a where a.lead_id = p_lead_id order by a.created_at limit v_cap)
    union all
    (select c.clicked_at, case when c.click_type = 'WHATSAPP' then 'WHATSAPP' else 'CALL' end, c.outcome, c.employee_id, c.lead_history_id, null,
            case when c.gap_seconds is null then null else jsonb_build_object('gap_seconds', c.gap_seconds) end
       from contact_click_log c where c.lead_id = p_lead_id order by c.clicked_at limit v_cap)
    union all
    (select n.created_at, 'NOTE', null, n.employee_id, n.lead_history_id, n.note,
            case when n.reminder_at is null then null else jsonb_build_object('reminder_at', n.reminder_at) end
       from lead_notes n where n.lead_id = p_lead_id order by n.created_at limit v_cap)
    union all
    (select v.created_at, case when v.event_type = 'BOOKED' then 'BOOKING' else 'VISIT' end, v.event_type, v.employee_id, null, v.note,
            jsonb_build_object('verified_at', v.verified_at, 'verified_by', vb.name, 'denied_at', v.denied_at, 'denied_by', vd.name, 'deny_reason', v.deny_reason)
       from site_visits v left join employees vb on vb.id = v.verified_by left join employees vd on vd.id = v.denied_by
       where v.lead_id = p_lead_id order by v.created_at limit v_cap)
    union all
    (select z.snoozed_at, 'SNOOZE', z.reason, z.employee_id, z.lead_history_id, null,
            jsonb_build_object('months', z.duration_months, 'until', z.snoozed_until, 'cancelled_at', z.cancelled_at, 'cancelled_by', zc.name)
       from lead_snooze_log z left join employees zc on zc.id = z.cancelled_by where z.lead_id = p_lead_id order by z.snoozed_at limit v_cap)
    union all
    (select r.restored_at, 'RESTORE', r.highest_positive, r.restored_by, r.new_lead_history_id, r.reason,
            jsonb_build_object('to_name', rt.name, 'restored_status', r.restored_status, 'restored_stage', r.restored_stage,
                               'protected_until', r.protected_until, 'undone_at', r.undone_at, 'undone_note', r.undone_note)
       from lead_restore_log r left join employees rt on rt.id = r.to_employee_id where r.lead_id = p_lead_id order by r.restored_at limit v_cap)
    union all
    (select g.created_at, 'GUARD', g.source || '/' || g.action, g.lead_owner_id, null, null,
            jsonb_build_object('mode', g.mode, 'holder_lead8', g.holder_lead_id8, 'holder_owner', gh.name)
       from lead_guard_events g left join employees gh on gh.id = g.holder_owner_id where g.lead_id = p_lead_id order by g.created_at limit v_cap)
    union all
    (select t.created_at, 'TRANSFER_REQUEST', t.status, t.requested_by_employee_id, null, t.reason,
            jsonb_build_object('to_name', tt.name, 'reviewed_at', t.reviewed_at, 'reviewed_by', tr.name)
       from lead_transfer_requests t left join employees tt on tt.id = t.transferred_to_employee_id left join employees tr on tr.id = t.reviewed_by_admin_id
       where t.lead_id = p_lead_id order by t.created_at limit v_cap)
    union all
    (select x.reserved_at, 'TEAM_RESERVATION', tm.name, x.reserved_by_employee_id, null, null, null
       from lead_team_reservations x left join teams tm on tm.id = x.team_id where x.lead_id = p_lead_id order by x.reserved_at limit v_cap)
    union all
    -- The owner's leave that overlapped their own assignment of this lead.
    (select greatest(lp.start_date::timestamp at time zone 'Asia/Kolkata', h.assigned_at), 'LEAVE', lp.reason, h.employee_id, h.id, null,
            jsonb_build_object('start_date', lp.start_date, 'end_date', lp.end_date)
       from lead_history h
       join employee_leave_periods lp on lp.employee_id = h.employee_id
        and lp.start_date::timestamp at time zone 'Asia/Kolkata' < coalesce((select min(n.assigned_at) from lead_history n where n.lead_id = h.lead_id and n.assigned_at > h.assigned_at), now())
        and coalesce(lp.end_date, 'infinity'::date)::timestamp at time zone 'Asia/Kolkata' + interval '1 day' > h.assigned_at
       where h.lead_id = p_lead_id order by 1 limit v_cap)
  )
  select coalesce(jsonb_agg(jsonb_build_object('at', ev.at, 'kind', ev.kind, 'detail', ev.detail, 'employee_id', ev.employee_id,
           'employee_name', e.name, 'stint_id', ev.stint_id, 'text', ev.text, 'extra', ev.extra) order by ev.at, ev.kind), '[]'::jsonb)
  into v_events
  from ev left join employees e on e.id = ev.employee_id;

  -- A category at the cap means there may be more rows than shown.
  select exists (select 1 from (
      select count(*) n from lead_activity_log where lead_id = p_lead_id
      union all select count(*) from contact_click_log where lead_id = p_lead_id
      union all select count(*) from lead_notes where lead_id = p_lead_id
      union all select count(*) from site_visits where lead_id = p_lead_id
      union all select count(*) from lead_guard_events where lead_id = p_lead_id) c where c.n > v_cap)
  into v_truncated;

  return jsonb_build_object('found', true, 'lead', v_lead, 'stints', v_stints, 'batches', v_batches, 'events', v_events,
                            'truncated', v_truncated, 'generated_at', now());
end;
$$;

revoke all on function public.get_admin_lead_full_journey(uuid) from public;
revoke all on function public.get_admin_lead_full_journey(uuid) from anon;
grant execute on function public.get_admin_lead_full_journey(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.get_admin_lead_full_journey(uuid)', 'EXECUTE') then
    raise exception 'anon can still execute';
  end if;
end $$;

commit;
