-- 2026-10-18 — ROLLBACK for 2026-10-18_db_auto_junk_guard.sql: mark_lead_junk_atomic back to
-- its pre-guard body (as read live on 2026-10-16), helper dropped.
begin;

create or replace function public.mark_lead_junk_atomic(p_lead_id uuid, p_lead_history_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin record;
  v_lead_name text;
begin
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

drop function if exists public.auto_junk_window_check(uuid, uuid);

commit;
