-- 2026-10-29 — Positive-history junk: admin list + "Restore and assign". NOT APPLIED — apply only after the owner's "haan".
-- Rollback (schema): 2026-10-29_positive_junk_restore_rollback.sql
-- Undo of individual restores: 2026-10-29_positive_junk_restore_undo.sql
-- Tests (dry-run only): 2026-10-29_positive_junk_restore_tests.sql
--
-- A lead the system junked (max recycles / repeat Not interested) although someone once had a real conversation
-- with it can be given back by an admin. Additive and backward compatible:
--   * lead_engine_settings.restore_protection_days (default 14)
--   * lead_activity_log.activity_type gains 'ADMIN_RESTORE' (existing values unchanged)
--   * new table lead_restore_log (full previous state, for undo)
--   * auto_junk_window_check: one extra early return — a restored lead is never auto-junked inside its protection
--   * new admin-only RPCs get_positive_junk_leads / restore_positive_junk_leads (SECURITY DEFINER, is_admin() inside,
--     EXECUTE for authenticated only). They never call assign_lead_atomic / recycle_lead_atomic.
-- DATA copies (a DATA lead whose number also exists as a LEAD) are listed but never restored or changed.
begin;

-- ---------------------------------------------------------------- 1) settings, activity type, undo log
alter table lead_engine_settings add column if not exists restore_protection_days integer not null default 14;
alter table lead_engine_settings add constraint lead_engine_settings_restore_protection_range check (restore_protection_days between 0 and 90);

alter table lead_activity_log drop constraint lead_activity_log_activity_type_check;
alter table lead_activity_log add constraint lead_activity_log_activity_type_check
  check (activity_type = any (array['STATUS_UPDATE'::text, 'BOARD_STAGE_MOVE'::text, 'ADMIN_RESTORE'::text]));

create table if not exists lead_restore_log (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id),
  restored_at timestamptz not null default now(),
  restored_by uuid not null references employees(id),
  to_employee_id uuid not null references employees(id),
  reason text not null,
  highest_positive text not null,
  restored_status text not null,
  restored_stage text not null,
  protected_until timestamptz not null,
  sibling_bypassed boolean not null default false,
  sibling jsonb,
  prev_state jsonb not null,
  new_lead_history_id uuid not null references lead_history(id),
  activity_id uuid references lead_activity_log(id),
  undone_at timestamptz,
  undone_note text
);
create index if not exists lead_restore_log_lead_idx on lead_restore_log (lead_id, restored_at desc);
alter table lead_restore_log enable row level security;   -- no policies: only the SECURITY DEFINER functions touch it
revoke all on lead_restore_log from anon, authenticated;

-- ---------------------------------------------------------------- 2) protection inside the existing auto-junk guard
CREATE OR REPLACE FUNCTION public.auto_junk_window_check(p_lead_id uuid, p_lead_history_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  l leads%rowtype;
  h lead_history%rowtype;
  v_switch boolean;
  v_ni int;
  v_has_activity boolean;
  v_days numeric;
  v_cooldown_end timestamptz;
  v_on_leave boolean;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into l from leads where id = p_lead_id;
  select * into h from lead_history where id = p_lead_history_id;
  if l.id is null or h.id is null then
    return null; -- let mark_lead_junk_atomic raise its own not-found errors
  end if;

  -- Positive-history restore (2026-10-29): a lead an admin gave back is never auto-junked inside its
  -- protection window (lead_engine_settings.restore_protection_days), whatever else applies below.
  if exists (select 1 from lead_restore_log r where r.lead_id = l.id and r.undone_at is null and r.protected_until > now()) then
    return format('restored by an admin, protected until %s',
      (select to_char(max(r.protected_until) at time zone 'Asia/Kolkata', 'DD Mon HH24:MI') from lead_restore_log r
       where r.lead_id = l.id and r.undone_at is null));
  end if;

  select count(*) into v_ni from lead_history x
  where x.lead_id = l.id and x.outcome = 'NOT_INTERESTED'
    and (l.last_unjunked_at is null or x.assigned_at > l.last_unjunked_at);
  if v_ni >= 2 then
    return null; -- repeat NOT_INTERESTED rule, unchanged
  end if;

  if coalesce(l.is_personal_lead, false) then
    return 'personal lead';
  end if;
  if l.status in ('CONNECTED', 'CONVERTED') or coalesce(l.board_stage, 'LEADS') <> 'LEADS' then
    return format('lead has progress (%s / %s)', l.status, coalesce(l.board_stage, 'LEADS'));
  end if;
  if h.pause_reason = 'VISIT_PENDING_VERIFICATION' or (h.paused_until is not null and now() < h.paused_until) then
    return 'lead is paused';
  end if;

  select coalesce(working_days_timers_enabled, false) into v_switch from lead_engine_settings where id = 1;
  v_has_activity := l.lead_type <> 'DATA' and h.last_activity_at is not null and h.assigned_at is not null
                    and h.last_activity_at > h.assigned_at;

  if v_has_activity then
    select exists (select 1 from employee_leave_periods p where p.employee_id = l.current_owner_id
                   and p.start_date <= v_today and (p.end_date is null or p.end_date >= v_today)) into v_on_leave;
    if v_on_leave then
      return 'owner is on leave';
    end if;
    v_days := extract(epoch from case when v_switch then working_elapsed(h.last_activity_at, now()) else now() - h.last_activity_at end) / 86400;
    if v_days < 6 then
      return format('owner worked it %s day(s) ago (window is 6)', round(v_days, 1));
    end if;
    return null;
  end if;

  if l.lead_type = 'DATA' and l.status in ('NEW', 'NOT_CONNECTED', 'SWITCHED_OFF') then
    if coalesce(h.call_count, 0) >= 4 then return null; end if;
    return format('DATA: %s of 4 attempts', coalesce(h.call_count, 0));
  end if;

  if l.status = 'NEW' then
    if l.sla_deadline is not null and now() >= l.sla_deadline then return null; end if;
    return format('first-contact SLA runs until %s', coalesce(to_char(l.sla_deadline at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'), 'no deadline'));
  end if;

  if l.status in ('NOT_CONNECTED', 'SWITCHED_OFF', 'NOT_INTERESTED') then
    if h.outcome_at is null then
      return 'cooldown: no outcome time on the current assignment';
    end if;
    v_cooldown_end := case when v_switch
      then working_add(h.outcome_at, make_interval(days => case when l.status = 'NOT_INTERESTED' then 7 else 3 end))
      else h.outcome_at + make_interval(days => case when l.status = 'NOT_INTERESTED' then 7 else 3 end) end;
    if now() >= v_cooldown_end then return null; end if;
    return format('cooldown runs until %s', to_char(v_cooldown_end at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'));
  end if;

  return format('status %s is not junkable by the sweep', l.status);
end;
$function$;

-- A LEAD copy of the same number that is positive with another active employee (DATA copies never count).
-- p_new_owner null = "with anyone" (list view); otherwise "with someone other than the new owner".
create or replace function public.restore_sibling_block(p_lead_id uuid, p_new_owner uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('holder_id8', left(s.id::text, 8), 'holder_owner_id', s.current_owner_id, 'owner_name', e.name,
           'stage', case when h.pause_reason in ('VISIT_LOCK', 'VISIT_PENDING_VERIFICATION') then 'VISIT'
                         when s.board_stage in ('FOLLOW_UP', 'VISIT', 'BOOKING') then s.board_stage else s.status end)
  from leads l
  join leads s on s.mobile_normalized = l.mobile_normalized and s.id <> l.id and s.lead_type = 'LEAD'
  join employees e on e.id = s.current_owner_id and e.is_active
  left join lead_history h on h.lead_id = s.id and h.is_active
  where l.id = p_lead_id
    and l.mobile_normalized ~ '^[0-9]{10}$'
    and s.status <> 'JUNK' and s.merged_into_lead_id is null
    and (p_new_owner is null or s.current_owner_id <> p_new_owner)
    and (s.board_stage in ('FOLLOW_UP', 'VISIT', 'BOOKING') or s.status in ('CONNECTED', 'CONVERTED')
         or h.pause_reason in ('VISIT_LOCK', 'VISIT_PENDING_VERIFICATION'))
  order by (s.board_stage = 'VISIT' or coalesce(h.pause_reason, '') like 'VISIT%') desc, s.id
  limit 1
$$;

-- ---------------------------------------------------------------- 3) which junk leads have a positive history
-- Positive evidence (any of them, any time): status CONNECTED / CONVERTED, a follow-up move, a site visit or booking,
-- a lead_history outcome CONNECTED / CONVERTED, or a recycle that recorded it was taken away from such a stage.
create or replace function public.positive_junk_rows(p_lead_id uuid default null)
returns table (
  lead_id uuid, lead_id8 text, card_type text, project text, stage_at_junk text,
  highest_positive text, restore_status text, restore_stage text,
  first_positive text, first_positive_at timestamptz, first_positive_by uuid, first_positive_by_name text,
  last_owner_id uuid, last_owner_name text, recycle_count integer,
  junked_at timestamptz, junked_by text, junk_reason text, last_activity_at timestamptz, not_interested_count integer,
  is_data_copy boolean, sibling jsonb, restored_before integer)
language sql stable security definer set search_path to 'public' as $$
  with j as (
    select l.* from leads l
    where l.status = 'JUNK' and l.merged_into_lead_id is null and (p_lead_id is null or l.id = p_lead_id)
  ),
  hist as (
    select h.*, lag(h.employee_id) over (partition by h.lead_id order by h.assigned_at) prev_employee_id
    from lead_history h join j on j.id = h.lead_id
  ),
  ev as (
    select a.lead_id, a.created_at at, case when a.activity_type = 'STATUS_UPDATE' then a.detail else coalesce(a.detail, 'FOLLOW_UP') end kind, a.employee_id
    from lead_activity_log a join j on j.id = a.lead_id
    where (a.activity_type = 'STATUS_UPDATE' and a.detail in ('CONNECTED', 'CONVERTED'))
       or (a.activity_type = 'BOARD_STAGE_MOVE' and a.detail in ('FOLLOW_UP', 'VISIT', 'BOOKING'))
    union all
    select v.lead_id, v.created_at, case when v.event_type = 'BOOKED' then 'BOOKING' else 'VISIT' end, v.employee_id
    from site_visits v join j on j.id = v.lead_id
    union all
    select h.lead_id, coalesce(h.outcome_at, h.assigned_at), h.outcome, h.employee_id
    from hist h where h.outcome in ('CONNECTED', 'CONVERTED')
    union all
    select h.lead_id, h.assigned_at, h.recycled_from_stage, h.prev_employee_id
    from hist h where h.recycled_from_stage in ('FOLLOW_UP', 'VISIT', 'BOOKING')
    union all
    select h.lead_id, h.assigned_at, h.recycled_from_status, h.prev_employee_id
    from hist h where h.recycled_from_status in ('CONNECTED', 'CONVERTED')
  ),
  rk as (
    select ev.*, case kind when 'BOOKING' then 5 when 'VISIT' then 4 when 'CONVERTED' then 3 when 'FOLLOW_UP' then 2 else 1 end r from ev
  ),
  agg as (
    select lead_id, max(r) top_rank,
           bool_or(kind = 'CONVERTED') ever_converted, bool_or(kind = 'FOLLOW_UP') ever_follow_up
    from rk group by lead_id
  )
  select j.id, left(j.id::text, 8), coalesce(j.lead_type, 'LEAD'), j.project, coalesce(j.board_stage, 'LEADS'),
         case agg.top_rank when 5 then 'BOOKING' when 4 then 'VISIT' when 3 then 'CONVERTED' when 2 then 'FOLLOW_UP' else 'CONNECTED' end,
         -- back to the highest positive point, never to a closed state (booking comes back as a converted lead at Visit)
         case when agg.ever_converted or agg.top_rank = 5 then 'CONVERTED' else 'CONNECTED' end,
         case when agg.top_rank >= 4 then 'VISIT' when agg.top_rank >= 2 and (agg.top_rank = 2 or agg.ever_follow_up) then 'FOLLOW_UP' else 'LEADS' end,
         fp.kind, fp.at, fp.employee_id, fe.name,
         lo.employee_id, lo.name, j.recycle_count,
         j.updated_at,
         case when exists (select 1 from lead_history h where h.lead_id = j.id and h.ended_reason = 'JUNK') then 'SYSTEM' else 'UNKNOWN' end,
         case when ni.n >= 2 then 'Repeat Not interested' when j.recycle_count >= 3 then 'Max recycles reached' else 'Other' end,
         la.at, ni.n_all,
         (coalesce(j.lead_type, 'LEAD') = 'DATA' and exists (
            select 1 from leads c where c.mobile_normalized = j.mobile_normalized and c.id <> j.id and c.lead_type = 'LEAD' and c.merged_into_lead_id is null)),
         restore_sibling_block(j.id, null),
         (select count(*)::int from lead_restore_log r where r.lead_id = j.id)
  from j
  join agg on agg.lead_id = j.id
  left join lateral (select rk.kind, rk.at, rk.employee_id from rk where rk.lead_id = j.id order by rk.at, rk.r desc limit 1) fp on true
  left join employees fe on fe.id = fp.employee_id
  left join lateral (select h.employee_id, e.name from lead_history h left join employees e on e.id = h.employee_id
                     where h.lead_id = j.id order by h.assigned_at desc limit 1) lo on true
  left join lateral (select greatest(
      (select max(a.created_at) from lead_activity_log a where a.lead_id = j.id and a.activity_type <> 'ADMIN_RESTORE'),
      (select max(n.created_at) from lead_notes n where n.lead_id = j.id),
      (select max(c.clicked_at) from contact_click_log c where c.lead_id = j.id)) at) la on true
  left join lateral (select count(*) filter (where j.last_unjunked_at is null or h.assigned_at > j.last_unjunked_at)::int n,
                            count(*)::int n_all
                     from lead_history h where h.lead_id = j.id and h.outcome = 'NOT_INTERESTED') ni on true
$$;

revoke all on function public.positive_junk_rows(uuid) from public, anon, authenticated;
revoke all on function public.restore_sibling_block(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 4) admin RPCs
create or replace function public.get_positive_junk_leads()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not coalesce((select is_admin()), false) then
    raise exception 'get_positive_junk_leads: admin only';
  end if;
  return jsonb_build_object(
    'protection_days', (select restore_protection_days from lead_engine_settings where id = 1),
    'max_batch', 25,
    'employees', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]'::jsonb)
                  from employees where is_active and department = 'sales'),
    'rows', (select coalesce(jsonb_agg(to_jsonb(r) order by r.junked_at desc), '[]'::jsonb) from positive_junk_rows(null) r));
end;
$$;

-- p_items: [{"lead_id": uuid, "employee_id": uuid}, ...] (1..25). p_dry_run = preview only (nothing written).
-- Each lead is handled on its own: RESTORED / WOULD_RESTORE / HELD (positive LEAD copy with someone else; pass
-- p_bypass_sibling after the admin's extra confirm) / REFUSED (with the reason). Never touches any other lead.
create or replace function public.restore_positive_junk_leads(p_items jsonb, p_reason text, p_bypass_sibling boolean default false, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_admin uuid := current_employee_id();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_days int := (select restore_protection_days from lead_engine_settings where id = 1);
  v_item jsonb;
  v_lead leads%rowtype;
  v_row record;
  v_emp record;
  v_block jsonb;
  v_hist uuid;
  v_act uuid;
  v_out jsonb := '[]'::jsonb;
  v_res jsonb;
begin
  if not coalesce((select is_admin()), false) or v_admin is null then
    raise exception 'restore_positive_junk_leads: admin only';
  end if;
  if v_reason is null or length(v_reason) < 5 then
    raise exception 'restore_positive_junk_leads: a reason (at least 5 characters) is required';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'restore_positive_junk_leads: pick at least one lead';
  end if;
  if jsonb_array_length(p_items) > 25 then
    raise exception 'restore_positive_junk_leads: at most 25 leads at a time (got %)', jsonb_array_length(p_items);
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    begin
      select * into v_lead from leads where id = (v_item->>'lead_id')::uuid for update;
      select * into v_emp from employees where id = (v_item->>'employee_id')::uuid;
      v_res := jsonb_build_object('lead_id', v_item->>'lead_id', 'lead_id8', left(v_item->>'lead_id', 8), 'employee_id', v_item->>'employee_id',
                                  'employee_name', v_emp.name);
      if v_lead.id is null then
        v_out := v_out || (v_res || jsonb_build_object('result', 'REFUSED', 'why', 'lead not found'));
        continue;
      end if;
      if v_lead.status <> 'JUNK' or v_lead.merged_into_lead_id is not null then
        v_out := v_out || (v_res || jsonb_build_object('result', 'REFUSED', 'why', format('lead is not junk any more (%s)', v_lead.status)));
        continue;
      end if;
      if v_emp.id is null or not v_emp.is_active or coalesce(v_emp.department, '') <> 'sales' then
        v_out := v_out || (v_res || jsonb_build_object('result', 'REFUSED', 'why', 'employee is not an active sales employee'));
        continue;
      end if;
      select * into v_row from positive_junk_rows(v_lead.id);
      if v_row.lead_id is null then
        v_out := v_out || (v_res || jsonb_build_object('result', 'REFUSED', 'why', 'no positive history'));
        continue;
      end if;
      if v_row.is_data_copy then
        v_out := v_out || (v_res || jsonb_build_object('result', 'REFUSED', 'why', 'DATA copy of a lead — never restored'));
        continue;
      end if;
      v_res := v_res || jsonb_build_object('to_status', v_row.restore_status, 'to_stage', v_row.restore_stage, 'highest_positive', v_row.highest_positive);

      v_block := restore_sibling_block(v_lead.id, v_emp.id);
      if v_block is not null and not p_bypass_sibling then
        if not p_dry_run then
          perform log_guard_event('admin_restore', 'ADMIN_RESTORE_HELD', v_lead.id,
            v_block || jsonb_build_object('to_employee_id', v_emp.id, 'reason', v_reason));
        end if;
        v_out := v_out || (v_res || jsonb_build_object('result', 'HELD', 'why', 'positive copy of this number is with another employee', 'sibling', v_block));
        continue;
      end if;

      if p_dry_run then
        v_out := v_out || (v_res || jsonb_build_object('result', 'WOULD_RESTORE', 'sibling', v_block));
        continue;
      end if;

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
              now() + make_interval(days => v_days), v_block is not null, v_block,
              jsonb_build_object('status', v_lead.status, 'board_stage', v_lead.board_stage, 'board_stage_changed_at', v_lead.board_stage_changed_at,
                                 'current_owner_id', v_lead.current_owner_id, 'recycle_count', v_lead.recycle_count,
                                 'last_unjunked_at', v_lead.last_unjunked_at, 'sla_deadline', v_lead.sla_deadline),
              v_hist, v_act);

      insert into lead_guard_events (source, action, lead_id, holder_lead_id8, lead_owner_id, holder_owner_id, project, mode, detail)
      values ('admin_restore', 'ADMIN_RESTORE', v_lead.id, v_block->>'holder_id8', v_emp.id, nullif(v_block->>'holder_owner_id', '')::uuid,
              v_lead.project, 'enforce',
              jsonb_build_object('reason', v_reason, 'by', v_admin, 'to_employee_id', v_emp.id, 'restored_status', v_row.restore_status,
                                 'restored_stage', v_row.restore_stage, 'sibling_bypassed', v_block is not null,
                                 'prev_state', jsonb_build_object('status', v_lead.status, 'board_stage', v_lead.board_stage,
                                   'current_owner_id', v_lead.current_owner_id, 'recycle_count', v_lead.recycle_count)));

      insert into notification (employee_id, employee_name, title, message, type, is_read, related_lead_id)
      values (v_emp.id, v_emp.name, 'A lead you worked on was given back to you',
              format('%s is back on your list (%s). Open it and follow up.', coalesce(v_lead.name, 'A lead'),
                     initcap(replace(case when v_row.restore_stage <> 'LEADS' then v_row.restore_stage else v_row.restore_status end, '_', ' '))),
              'LEAD_RESTORED', false, v_lead.id);

      v_out := v_out || (v_res || jsonb_build_object('result', 'RESTORED', 'sibling_bypassed', v_block is not null,
                                                     'protected_until', now() + make_interval(days => v_days)));
    exception when others then
      v_out := v_out || (coalesce(v_res, jsonb_build_object('lead_id', v_item->>'lead_id')) || jsonb_build_object('result', 'ERROR', 'why', sqlerrm));
    end;
  end loop;
  return v_out;
end;
$$;

revoke all on function public.get_positive_junk_leads() from public, anon;
revoke all on function public.restore_positive_junk_leads(jsonb, text, boolean, boolean) from public, anon;
grant execute on function public.get_positive_junk_leads() to authenticated;
grant execute on function public.restore_positive_junk_leads(jsonb, text, boolean, boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
