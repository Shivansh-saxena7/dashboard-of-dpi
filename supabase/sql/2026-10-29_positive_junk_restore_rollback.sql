-- Rollback for 2026-10-29_positive_junk_restore.sql. Run 2026-10-29_positive_junk_restore_undo.sql first for any lead
-- that should go back to JUNK; this file removes the feature itself. The restore audit rows in lead_activity_log
-- (activity_type ADMIN_RESTORE) are copied into lead_guard_events.detail before they are removed, so nothing is lost.
begin;
drop function if exists public.restore_positive_junk_leads(jsonb, text, boolean, boolean);
drop function if exists public.get_positive_junk_leads();
drop function if exists public.positive_junk_rows(uuid);
drop function if exists public.restore_sibling_block(uuid, uuid);

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

insert into lead_guard_events (source, action, lead_id, project, mode, detail)
select 'admin_restore', 'ADMIN_RESTORE_ACTIVITY_ARCHIVED', a.lead_id, l.project, 'enforce',
       jsonb_build_object('activity_id', a.id, 'lead_history_id', a.lead_history_id, 'employee_id', a.employee_id, 'detail', a.detail, 'created_at', a.created_at)
from lead_activity_log a join leads l on l.id = a.lead_id where a.activity_type = 'ADMIN_RESTORE';
update lead_restore_log set activity_id = null where activity_id is not null;
delete from lead_activity_log where activity_type = 'ADMIN_RESTORE';
alter table lead_activity_log drop constraint lead_activity_log_activity_type_check;
alter table lead_activity_log add constraint lead_activity_log_activity_type_check
  check (activity_type = any (array['STATUS_UPDATE'::text, 'BOARD_STAGE_MOVE'::text]));

-- lead_restore_log is kept (it is the record of what was restored and its previous state); drop it by hand once not needed:
--   drop table lead_restore_log;
alter table lead_engine_settings drop constraint if exists lead_engine_settings_restore_protection_range;
alter table lead_engine_settings drop column if exists restore_protection_days;
notify pgrst, 'reload schema';
commit;
