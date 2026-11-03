-- 2026-11-02 — "Given by admin" filter rule v2. NOT APPLIED — apply only after the owner's "haan" (LF copy).
-- Needs 2026-11-02_given_lead_context.sql (applied 17:19 IST). Rollback: 2026-11-02_given_lead_context_rule_v2_rollback.sql
-- A lead leaves the filter only on the caller's first call or first result on this assignment, not on a note, reminder,
-- stage move or the pause-expiry sweep. Same function, same grants; only in_filter changes.
begin;

create or replace function public.given_lead_context_for(p_employee uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with g as (
    select distinct on (h.id) l.id lead_id, l.lead_type, h.id hid, h.assigned_at, h.call_count, h.first_call_at, h.outcome_at,
           r.restored_at given_at, r.protected_until
    from lead_history h
    join leads l on l.id = h.lead_id and l.current_owner_id = p_employee
    join lead_restore_log r on r.new_lead_history_id = h.id and r.undone_at is null and r.protected_until > now()
    where h.employee_id = p_employee and h.is_active
    order by h.id, r.protected_until desc
  )
  select jsonb_build_object('enabled', true, 'leads', coalesce(jsonb_agg(jsonb_build_object(
    'lead_id', g.lead_id,
    'lead_type', g.lead_type,
    'given_at', g.given_at,
    'protected_until', g.protected_until,
    -- the "Given by admin" filter: no call and no result yet on this assignment. A note, reminder, stage move or the sweep
    -- moves last_activity_at, so it is not used. A restore sets outcome_at at the moment of assigning, so only a later one counts.
    'in_filter', g.call_count = 0 and g.first_call_at is null and (g.outcome_at is null or g.outcome_at <= g.assigned_at + interval '2 seconds')
      and not exists (select 1 from lead_activity_log a where a.lead_history_id = g.hid and a.activity_type = 'STATUS_UPDATE'),
    'last_positive', case when lp.at_ is null then null else jsonb_build_object('kind', lp.kind, 'at', lp.at_, 'is_you', lp.by_id = p_employee) end,
    'note', case when coalesce(ne.id, no.id) is null then null else jsonb_build_object(
      -- the caller's own words stay as written
      'text', case when lp.by_id = p_employee then coalesce(ne.note, no.note) else given_note_mask(coalesce(ne.note, no.note)) end,
      'at', coalesce(ne.created_at, no.created_at),
      'match', case when ne.id is not null then 'exact' else 'other_time' end) end,
    'after', case when af.at_ is null then null else jsonb_build_object('outcome', af.detail, 'at', af.at_) end,
    'your_notes', yn.notes
  ) order by g.given_at desc), '[]'::jsonb))
  from g
  -- last positive conversation before this assignment began; lead_history.outcome is not used, it gets overwritten
  left join lateral (
    select e.kind, e.at_, e.by_id from (
      select a.detail kind, a.created_at at_, a.employee_id by_id from lead_activity_log a
        where a.lead_id = g.lead_id and a.created_at < g.assigned_at
          and ((a.activity_type = 'STATUS_UPDATE' and a.detail in ('CONNECTED', 'CONVERTED'))
            or (a.activity_type = 'BOARD_STAGE_MOVE' and a.detail in ('FOLLOW_UP', 'VISIT', 'BOOKING')))
      union all
      select case when v.event_type = 'BOOKED' then 'BOOKING' else 'VISIT' end, v.created_at, v.employee_id from site_visits v
        where v.lead_id = g.lead_id and v.created_at < g.assigned_at and v.denied_at is null
    ) e order by e.at_ desc limit 1
  ) lp on true
  -- that employee's note saved with it (within 3 minutes), else their latest note on this lead
  left join lateral (
    select n.id, n.note, n.created_at from lead_notes n
    where lp.at_ is not null and n.lead_id = g.lead_id and n.employee_id = lp.by_id and n.created_at < g.assigned_at and btrim(coalesce(n.note, '')) <> ''
      and abs(extract(epoch from n.created_at - lp.at_)) <= 180
    order by abs(extract(epoch from n.created_at - lp.at_)) limit 1
  ) ne on true
  left join lateral (
    select n.id, n.note, n.created_at from lead_notes n
    where lp.at_ is not null and ne.id is null and n.lead_id = g.lead_id and n.employee_id = lp.by_id and n.created_at < g.assigned_at and btrim(coalesce(n.note, '')) <> ''
    order by n.created_at desc limit 1
  ) no on true
  -- the latest result after it, before this assignment
  left join lateral (
    select a.detail, a.created_at at_ from lead_activity_log a
    where lp.at_ is not null and a.lead_id = g.lead_id and a.activity_type = 'STATUS_UPDATE' and a.created_at > lp.at_ and a.created_at < g.assigned_at
    order by a.created_at desc limit 1
  ) af on true
  -- the caller's own earlier notes on this lead (not the one already shown above), newest first, at most 3
  left join lateral (
    select coalesce(jsonb_agg(jsonb_build_object('at', x.created_at, 'note', x.note, 'outcome', x.outcome) order by x.created_at desc), '[]'::jsonb) notes from (
      select n.created_at, n.note,
        (select a.detail from lead_activity_log a where a.lead_id = n.lead_id and a.employee_id = n.employee_id and a.activity_type = 'STATUS_UPDATE'
           and abs(extract(epoch from a.created_at - n.created_at)) <= 180 order by abs(extract(epoch from a.created_at - n.created_at)) limit 1) outcome
      from lead_notes n
      where n.lead_id = g.lead_id and n.employee_id = p_employee and n.created_at < g.assigned_at and btrim(coalesce(n.note, '')) <> ''
        and n.id is distinct from coalesce(ne.id, no.id)
      order by n.created_at desc limit 3
    ) x
  ) yn on true
$$;

commit;
