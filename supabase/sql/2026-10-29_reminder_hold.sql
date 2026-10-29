-- 2026-10-29 — Reminder hold (G5 fix). NOT APPLIED — apply only after the owner's "haan".
-- Rollback: 2026-10-29_reminder_hold_rollback.sql   Tests (dry-run only): 2026-10-29_reminder_hold_tests.sql
--
-- The 6-day Follow-up inactivity recycle ignored a follow-up reminder the owner had set for later. Rule (same as
-- lib/reminderHold.ts): the latest reminder on the current assignment counts as activity at its own time, capped at
-- reminder_hold_max_days (30) after the owner's real last activity; the 6-day window runs from that moment.
-- reminder_hold_mode: 'off' | 'shadow' (default — only lead_guard_events rows "REMINDER_HOLD would skip", nothing
-- else changes) | 'enforce'. The recycle sweep (edge function) reads the same two settings.
-- Additive: two settings columns, one new helper, one early return in auto_junk_window_check (enforce only) and one
-- shadow log in mark_lead_junk_atomic. Both functions keep every existing check exactly as before.
begin;

alter table lead_engine_settings
  add column if not exists reminder_hold_max_days integer not null default 30,
  add column if not exists reminder_hold_mode text not null default 'shadow';
alter table lead_engine_settings add constraint lead_engine_settings_reminder_hold_check
  check (reminder_hold_max_days between 1 and 90 and reminder_hold_mode in ('off', 'shadow', 'enforce'));

-- Until when a pending reminder keeps this assignment from the inactivity recycle / junk, or null.
create or replace function public.reminder_hold_until(p_lead_history_id uuid)
returns timestamptz language plpgsql stable security definer set search_path to 'public' as $$
declare
  h lead_history%rowtype;
  v_max int := coalesce((select reminder_hold_max_days from lead_engine_settings where id = 1), 30);
  v_switch boolean := coalesce((select working_days_timers_enabled from lead_engine_settings where id = 1), false);
  v_reminder timestamptz;
  v_last timestamptz;
  v_start timestamptz;
  v_until timestamptz;
begin
  select * into h from lead_history where id = p_lead_history_id;
  if h.id is null or not h.is_active then
    return null;
  end if;
  select max(n.reminder_at) into v_reminder from lead_notes n where n.lead_history_id = h.id and n.reminder_at is not null;
  v_last := coalesce(h.last_activity_at, h.assigned_at);
  if v_reminder is null or v_last is null or v_reminder <= v_last then
    return null;
  end if;
  v_start := least(v_reminder, v_last + make_interval(days => v_max));
  v_until := case when v_switch then working_add(v_start, interval '6 days') else v_start + interval '6 days' end;
  return case when v_until > now() then v_until end;
end;
$$;
revoke all on function public.reminder_hold_until(uuid) from public, anon, authenticated;

-- The junk-guard form of the hold: never for a repeat Not interested (the owner's own result, same
-- count as auto_junk_window_check), otherwise the reason text while the hold lasts, else null.
create or replace function public.reminder_hold_block(p_lead_id uuid, p_lead_history_id uuid)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_unjunked timestamptz := (select last_unjunked_at from leads where id = p_lead_id);
  v_ni int;
  v_until timestamptz;
begin
  select count(*) into v_ni from lead_history x
  where x.lead_id = p_lead_id and x.outcome = 'NOT_INTERESTED' and (v_unjunked is null or x.assigned_at > v_unjunked);
  if v_ni >= 2 then
    return null;
  end if;
  v_until := reminder_hold_until(p_lead_history_id);
  if v_until is null then
    return null;
  end if;
  return format('owner follow-up reminder pending, hold until %s', to_char(v_until at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'));
end;
$$;
revoke all on function public.reminder_hold_block(uuid, uuid) from public, anon, authenticated;

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

  -- Reminder hold (G5 fix, 2026-10-29): in "enforce" mode a pending follow-up reminder by the
  -- current owner keeps the lead (same capped rule as lib/reminderHold.ts). "shadow" never refuses
  -- here; mark_lead_junk_atomic records what would have been refused.
  if (select reminder_hold_mode from lead_engine_settings where id = 1) = 'enforce' and reminder_hold_block(l.id, h.id) is not null then
    return reminder_hold_block(l.id, h.id);
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

CREATE OR REPLACE FUNCTION public.mark_lead_junk_atomic(p_lead_id uuid, p_lead_history_id uuid, p_reason text)
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
      perform log_guard_event('db_auto_junk_guard', 'JUNK_REFUSED', p_lead_id,
        jsonb_build_object('block', v_block, 'reason', p_reason, 'lead_history_id', p_lead_history_id));
      perform log_anomaly('db_auto_junk_guard', 'error',
        format('Auto-junk refused for lead %s: %s (reason given: %s)', left(p_lead_id::text, 8), v_block, coalesce(p_reason, '-')),
        jsonb_build_object('lead_id8', left(p_lead_id::text, 8), 'lead_history_id', p_lead_history_id, 'block', v_block,
          'reason', p_reason, 'recycle_count', (select recycle_count from leads where id = p_lead_id)));
      raise warning 'mark_lead_junk_atomic: refused for %: %', left(p_lead_id::text, 8), v_block;
      return;
    end if;
    -- Reminder hold, shadow mode (2026-10-29): record that the hold would have kept this lead.
    if (select reminder_hold_mode from lead_engine_settings where id = 1) = 'shadow' and reminder_hold_block(p_lead_id, p_lead_history_id) is not null then
      insert into lead_guard_events (source, action, lead_id, lead_owner_id, project, mode, detail)
      select 'db_reminder_hold', 'REMINDER_HOLD', l.id, l.current_owner_id, l.project, 'shadow',
             jsonb_build_object('message', 'REMINDER_HOLD would skip', 'would', 'refuse junk', 'reason', p_reason,
                                'lead_history_id', p_lead_history_id, 'hold_until', reminder_hold_until(p_lead_history_id))
      from leads l where l.id = p_lead_id;
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

notify pgrst, 'reload schema';
commit;
