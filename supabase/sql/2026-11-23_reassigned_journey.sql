-- 2026-11-23 "Previously with" tag + Journey on the employee's lead card, ONLY for leads given from the Performance
-- Report (perf_reassign_batch_leads). DRAFT, NOT APPLIED. Needs 2026-11-23_perf_report_reassign.sql (applied 23 Nov).
-- Apply only on the owner's "haan", from an LF copy, after a rolled-back dry run, at least 2 minutes away from a sweep
-- (:00/:15/:30/:45 IST) and the hourly refresh (:37 IST). Rollback: 2026-11-23_reassigned_journey_rollback.sql.
--
-- Additive: two settings columns (default off), two employee-side functions. Nothing existing changes.
--   * reassigned_journey_mode: 'off' (default) | 'admin_pilot' (only reassigned_journey_pilot_ids) | 'on'.
--   * get_my_reassigned_leads(): one call per list. The caller's own leads whose CURRENT assignment was made from the
--     report: lead id, "previously with" (that person's name) and when it was given. Nothing else.
--   * get_reassigned_lead_context(lead): on tap. Only for the lead's current owner and only while the current
--     assignment is the one the report made; otherwise null. Previous person, their dates and result, and every
--     assignment of the lead (who, how it came, dates, what happened), with "Given by admin" where the report moved it.
-- Never returned to employees: batch ids, the admin's reason or label, who the admin was, notes, phone numbers.
begin;

alter table public.lead_engine_settings
  add column if not exists reassigned_journey_mode text not null default 'off'
    constraint lead_engine_settings_reassigned_journey_mode_check check (reassigned_journey_mode in ('off', 'admin_pilot', 'on')),
  add column if not exists reassigned_journey_pilot_ids uuid[] not null default '{}';

-- Is the tag on for this employee? Internal (no grant).
create or replace function public.reassigned_journey_allowed(p_employee uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select p_employee is not null and coalesce((
    select s.reassigned_journey_mode = 'on' or (s.reassigned_journey_mode = 'admin_pilot' and p_employee = any (s.reassigned_journey_pilot_ids))
    from lead_engine_settings s where s.id = 1), false)
$$;

-- How an assignment came, in employee words' order (same rule as the report's journey).
create or replace function public.reassigned_stint_origin(p_stint uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select case when h.assigned_by_type = 'SELF' then 'SELF'
              when h.assigned_at = (select min(f.assigned_at) from lead_history f where f.lead_id = h.lead_id) then 'FRESH'
              when h.recycle_reason is not null then 'RECYCLED'
              when exists (select 1 from perf_reassign_batch_leads bl where bl.new_stint_id = h.id and bl.status = 'moved') then 'ADMIN_GIVEN'
              when exists (select 1 from lead_restore_log rl left join lead_activity_log ra on ra.id = rl.activity_id
                           where rl.lead_id = h.lead_id and rl.new_lead_history_id = h.id and ra.activity_type is distinct from 'ADMIN_REASSIGN') then 'RESTORED'
              when h.assigned_by_type = 'ADMIN' then 'ADMIN_GIVEN' else 'OTHER' end
  from lead_history h where h.id = p_stint
$$;

-- The caller's own leads whose current assignment the report made. Bounded by the caller's own current leads.
create or replace function public.get_my_reassigned_leads()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare me uuid := current_employee_id();
begin
  if me is null or not reassigned_journey_allowed(me) then return jsonb_build_object('enabled', false, 'leads', '[]'::jsonb); end if;
  return jsonb_build_object('enabled', true, 'leads', coalesce((
    select jsonb_agg(jsonb_build_object('lead_id', l.id, 'previously_with', pe.name, 'given_at', h.assigned_at) order by h.assigned_at desc)
    from leads l
    join lateral (select x.id, x.assigned_at, x.employee_id from lead_history x where x.lead_id = l.id and x.is_active
                  order by x.assigned_at desc, x.id desc limit 1) h on h.employee_id = me
    join lateral (select bl.from_employee_id from perf_reassign_batch_leads bl join perf_reassign_batches pb on pb.id = bl.batch_id
                  where bl.new_stint_id = h.id and bl.lead_id = l.id and bl.status = 'moved' and pb.mode in ('give', 'give_back') limit 1) b on true
    left join employees pe on pe.id = b.from_employee_id
    where l.current_owner_id = me and l.merged_into_lead_id is null), '[]'::jsonb));
end;
$$;

-- One lead's journey for its current owner, only while the current assignment is the report's. Else null.
create or replace function public.get_reassigned_lead_context(p_lead_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare me uuid := current_employee_id(); cur record; b record;  -- an undo (mode 'undo') never shows a tag
begin
  if me is null or p_lead_id is null or not reassigned_journey_allowed(me) then return null; end if;
  select h.id, h.assigned_at, h.employee_id into cur from leads l join lead_history h on h.lead_id = l.id and h.is_active
  where l.id = p_lead_id and l.current_owner_id = me and l.merged_into_lead_id is null
  order by h.assigned_at desc, h.id desc limit 1;  -- the latest active assignment only
  if not found or cur.employee_id is distinct from me then return null; end if;
  select bl.from_employee_id, bl.from_stint_id into b from perf_reassign_batch_leads bl join perf_reassign_batches pb on pb.id = bl.batch_id
  where bl.new_stint_id = cur.id and bl.lead_id = p_lead_id and bl.status = 'moved' and pb.mode in ('give', 'give_back') limit 1;
  if not found then return null; end if;
  return jsonb_build_object(
    'lead_id', p_lead_id,
    'previously_with', (select name from employees where id = b.from_employee_id),
    'given_at', cur.assigned_at,
    'previous', (select jsonb_build_object('assigned_at', h.assigned_at,
                   'ended_at', (select min(n.assigned_at) from lead_history n where n.lead_id = h.lead_id and n.assigned_at > h.assigned_at))
                   || (perf_stint_facts(h.id) - 'connected')
                 from lead_history h where h.id = b.from_stint_id),
    'journey', coalesce((select jsonb_agg(jsonb_build_object(
        'employee', case when h.employee_id = me then 'You' else e.name end,
        'is_you', h.employee_id = me,
        'origin', reassigned_stint_origin(h.id),
        'given_by_admin', exists (select 1 from perf_reassign_batch_leads bl where bl.new_stint_id = h.id and bl.status = 'moved'),
        'assigned_at', h.assigned_at,
        'ended_at', (select min(n.assigned_at) from lead_history n where n.lead_id = h.lead_id and n.assigned_at > h.assigned_at),
        'current', h.id = cur.id) || (perf_stint_facts(h.id) - 'connected') order by h.assigned_at, h.id)
      from lead_history h left join employees e on e.id = h.employee_id where h.lead_id = p_lead_id), '[]'::jsonb));
end;
$$;

revoke all on function public.reassigned_journey_allowed(uuid), public.reassigned_stint_origin(uuid) from public, anon, authenticated;
revoke all on function public.get_my_reassigned_leads(), public.get_reassigned_lead_context(uuid) from public, anon;
grant execute on function public.get_my_reassigned_leads(), public.get_reassigned_lead_context(uuid) to authenticated;

commit;
