-- 2026-10-18 — DB-side auto-junk guard. Rollback: 2026-10-18_db_auto_junk_guard_rollback.sql
--
-- Goal: the "junk 15 minutes after the 3rd recycle" bug can never come back, even if an
-- old recycle-stale-leads build is deployed. mark_lead_junk_atomic is the only auto-junk
-- path (called by the sweep). For any caller that is not an admin it now checks, in the
-- DB, that the junk is allowed:
--   - repeat NOT_INTERESTED (2+ outcomes since the last unjunk)        -> allowed, as before
--   - otherwise (max recycles) the CURRENT owner's own window must be over, computed the
--     same way as lib/calculateSLAStatus.ts:
--       visit pending verification / paused            -> not over
--       CONNECTED / CONVERTED / stage past LEADS        -> never auto-junked
--       LEAD with activity after assignment            -> 6 days since last activity
--                                                         (working days when the switch is on;
--                                                         owner on leave = not over)
--       DATA (NEW / NOT_CONNECTED / SWITCHED_OFF)      -> 4+ call attempts
--       NEW                                             -> sla_deadline passed
--       NOT_CONNECTED / SWITCHED_OFF (3 days), NOT_INTERESTED (7 days) -> cooldown from outcome_at
-- A refused junk changes nothing (no junk, no recycle — the sweep `continue`s), writes one
-- system_anomaly_log row (source db_auto_junk_guard, visible on /admin/system-health) and
-- returns normally so any deployed sweep keeps running. Admin callers are not checked.
-- The signature of mark_lead_junk_atomic is unchanged.

begin;

create or replace function public.auto_junk_window_check(p_lead_id uuid, p_lead_history_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
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

create or replace function public.mark_lead_junk_atomic(p_lead_id uuid, p_lead_history_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin record;
  v_lead_name text;
  v_block text;
begin
  -- DB-side auto-junk guard (2026-10-18): only checked for non-admin callers (the sweep).
  if not coalesce((select is_admin()), false) then
    v_block := auto_junk_window_check(p_lead_id, p_lead_history_id);
    if v_block is not null then
      perform log_anomaly('db_auto_junk_guard', 'error',
        format('Auto-junk refused for lead %s: %s (reason given: %s)', left(p_lead_id::text, 8), v_block, coalesce(p_reason, '-')),
        jsonb_build_object('lead_id8', left(p_lead_id::text, 8), 'lead_history_id', p_lead_history_id, 'block', v_block,
          'reason', p_reason, 'recycle_count', (select recycle_count from leads where id = p_lead_id)));
      raise warning 'mark_lead_junk_atomic: refused for %: %', left(p_lead_id::text, 8), v_block;
      return;
    end if;
  end if;

  select name into v_lead_name from leads where id = p_lead_id;
  update leads
  set status = 'JUNK'
  where id = p_lead_id;
  if not found then
    raise exception 'mark_lead_junk_atomic: lead % not found', p_lead_id;
  end if;
  update lead_history
  set is_active = false,
      ended_reason = 'JUNK'
  where id = p_lead_history_id
    and is_active = true;
  if not found then
    raise exception 'mark_lead_junk_atomic: lead_history % not found or already inactive', p_lead_history_id;
  end if;
  for v_admin in select id, name from employees where role in ('admin', 'super_admin') and is_active = true
  loop
    insert into notification (employee_id, employee_name, title, message, type, is_read)
    values (
      v_admin.id,
      v_admin.name,
      'Lead marked JUNK',
      format('%s was auto-marked JUNK (%s) — flagged for review.', coalesce(v_lead_name, 'A lead'), p_reason),
      'LEAD_JUNKED',
      false
    );
  end loop;
end;
$function$;

revoke all on function public.auto_junk_window_check(uuid, uuid) from public, anon, authenticated;

commit;
