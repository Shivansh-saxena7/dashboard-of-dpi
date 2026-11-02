-- 2026-11-02 — "Given by admin" filter and context box for employees. NOT APPLIED — apply only after the owner's "haan" (LF copy).
-- Rollback: 2026-11-02_given_lead_context_rollback.sql   Tests (dry-run only): 2026-11-02_given_lead_context_tests.sql
-- Parity (read-only, after apply): 2026-11-02_given_lead_context_parity.sql
--
-- A lead an admin gave back (restore_positive_junk_leads / reassign_keep_state_atomic) has a lead_restore_log row whose
-- new_lead_history_id is the active assignment. Employees cannot read that table, the activity log or anyone else's notes,
-- so this read-only function returns, only for the caller's own such leads, what they need to pick the lead up again.
-- Other employees' names and ids are never returned, only is_you. Nothing is written anywhere: no note, no last_activity_at.
-- given_lead_context_mode: 'off' (default, returns enabled=false) | 'admin_pilot' (only given_lead_context_pilot_ids) | 'on'.
begin;

alter table lead_engine_settings
  add column if not exists given_lead_context_mode text not null default 'off',
  add column if not exists given_lead_context_pilot_ids uuid[] not null default '{}';
alter table lead_engine_settings add constraint lead_engine_settings_given_lead_context_mode_check
  check (given_lead_context_mode in ('off', 'admin_pilot', 'on'));

-- Employee names inside a note written by someone else: full name and first name, whole words, any case. A surname alone
-- is left as it is, because it is far more likely to be a client's ("Sharma ji"). 2 Nov: 8,456 notes, about 20 hits, none a client.
create or replace function public.given_note_mask(p_note text)
returns text language sql stable security definer set search_path to 'public' as $$
  select case when pat.p is null then p_note else regexp_replace(p_note, pat.p, 'a team member', 'gi') end
  from (
    select '\m(' || string_agg(alt, '|' order by length(alt) desc) || ')\M' p from (
      select distinct alt from employees e
      cross join lateral (
        select array_agg(w order by ord) words from (
          select regexp_replace(t.w, '[^A-Za-z]', '', 'g') w, t.ord from regexp_split_to_table(e.name, '\s+') with ordinality t(w, ord)
        ) x where length(w) >= 2 and lower(w) not in ('mr', 'mrs', 'ms', 'dr')
      ) n
      cross join lateral unnest(array[n.words[1], array_to_string(n.words, '\s+')]) alt
      where n.words is not null and length(n.words[1]) >= 3 and lower(n.words[1]) not in ('testing', 'cordinator', 'sales', 'admin', 'test')
    ) names
  ) pat
$$;
revoke all on function public.given_note_mask(text) from public, anon, authenticated;
grant execute on function public.given_note_mask(text) to service_role;

-- The context of one employee's given leads. Not callable by employees directly: it takes any employee id.
create or replace function public.given_lead_context_for(p_employee uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with g as (
    select distinct on (h.id) l.id lead_id, l.lead_type, h.id hid, h.assigned_at, h.call_count, h.first_call_at, h.last_activity_at,
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
    -- the "Given by admin" filter: not called and nothing done yet on this assignment. Not outcome_at: a restore sets it.
    'in_filter', g.call_count = 0 and g.first_call_at is null and (g.last_activity_at is null or g.last_activity_at <= g.assigned_at + interval '2 seconds'),
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
revoke all on function public.given_lead_context_for(uuid) from public, anon, authenticated;
grant execute on function public.given_lead_context_for(uuid) to service_role;

-- What the app calls: the caller's own leads only, and nothing while the flag does not include them.
create or replace function public.get_given_lead_context()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_employee uuid := current_employee_id();
  v_mode text;
  v_pilots uuid[];
begin
  if v_employee is null then
    return jsonb_build_object('enabled', false, 'leads', '[]'::jsonb);
  end if;
  select given_lead_context_mode, given_lead_context_pilot_ids into v_mode, v_pilots from lead_engine_settings where id = 1;
  if coalesce(v_mode, 'off') = 'on' or (v_mode = 'admin_pilot' and v_employee = any(v_pilots)) then
    return given_lead_context_for(v_employee);
  end if;
  return jsonb_build_object('enabled', false, 'leads', '[]'::jsonb);
end;
$$;
revoke all on function public.get_given_lead_context() from public, anon;
grant execute on function public.get_given_lead_context() to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
