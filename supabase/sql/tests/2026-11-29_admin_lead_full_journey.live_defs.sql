-- Live definitions (pg_get_functiondef, 2026-11-28) of the functions get_admin_lead_full_journey builds on. Test input only.
CREATE OR REPLACE FUNCTION public.get_lead_journey(p_lead_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not coalesce((select is_admin()), false) then raise exception 'perf report: admin only'; end if;
  return jsonb_build_object('lead_id', p_lead_id,
    'stints', coalesce((select jsonb_agg(jsonb_build_object('stint_id', h.id, 'employee_id', h.employee_id, 'employee_name', e.name, 'assigned_at', h.assigned_at,
        'ended_at', (select min(n.assigned_at) from lead_history n where n.lead_id = h.lead_id and n.assigned_at > h.assigned_at), 'active', h.is_active,
        'origin', case when h.assigned_by_type = 'SELF' then 'SELF'
                       when h.assigned_at = (select min(f.assigned_at) from lead_history f where f.lead_id = h.lead_id) then 'FRESH'
                       when h.recycle_reason is not null then 'RECYCLED'
                       when exists (select 1 from lead_restore_log rl left join lead_activity_log ra on ra.id = rl.activity_id where rl.lead_id = h.lead_id and rl.new_lead_history_id = h.id
                         and ra.activity_type is distinct from 'ADMIN_REASSIGN') then 'RESTORED'
                       when h.assigned_by_type = 'ADMIN' then 'ADMIN_GIVEN' else 'OTHER' end) || perf_stint_facts(h.id) order by h.assigned_at, h.id)
      from lead_history h left join employees e on e.id = h.employee_id where h.lead_id = p_lead_id), '[]'::jsonb));
end;
$function$

;
CREATE OR REPLACE FUNCTION public.get_lead_report_batches(p_lead_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not coalesce((select is_admin()), false) then raise exception 'report reassign: admin only'; end if;
  return jsonb_build_object('lead_id', p_lead_id, 'batches', coalesce((select jsonb_agg(jsonb_build_object('batch_id', b.id, 'at', b.created_at, 'mode', b.mode, 'label', b.label, 'reason', b.reason,
        'from_employee_id', bl.from_employee_id, 'from_name', fe.name, 'to_employee_id', bl.to_employee_id, 'to_name', te.name, 'status', bl.status,
        'skip_reason', bl.skip_reason, 'new_stint_id', bl.new_stint_id) order by b.created_at)
      from perf_reassign_batch_leads bl join perf_reassign_batches b on b.id = bl.batch_id
      left join employees fe on fe.id = bl.from_employee_id left join employees te on te.id = bl.to_employee_id where bl.lead_id = p_lead_id), '[]'::jsonb));
end;
$function$

;
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from employees
    where auth_user_id = auth.uid() and is_active and role in ('admin','super_admin')
  );
$function$

;
CREATE OR REPLACE FUNCTION public.perf_stint_facts(p_stint_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with h as (
    select h.*, coalesce((select min(n.assigned_at) from lead_history n where n.lead_id = h.lead_id and n.assigned_at > h.assigned_at), 'infinity'::timestamptz) as end_at
    from lead_history h where h.id = p_stint_id
  )
  select jsonb_build_object(
    'followup', exists (select 1 from lead_activity_log a, h where a.lead_id = h.lead_id and a.lead_history_id = h.id and a.activity_type = 'BOARD_STAGE_MOVE' and a.detail = 'FOLLOW_UP'),
    'visit', exists (select 1 from site_visits v, h where v.lead_id = h.lead_id and v.employee_id = h.employee_id and v.event_type in ('VISIT', 'REVISIT') and v.denied_at is null and v.created_at >= h.assigned_at and v.created_at < h.end_at),
    'converted', exists (select 1 from lead_activity_log a, h where a.lead_id = h.lead_id and a.lead_history_id = h.id and a.activity_type = 'STATUS_UPDATE' and a.detail = 'CONVERTED'),
    'connected', exists (select 1 from lead_activity_log a, h where a.lead_id = h.lead_id and a.lead_history_id = h.id and (a.detail in ('CONNECTED', 'CONVERTED', 'NOT_INTERESTED') and a.activity_type = 'STATUS_UPDATE' or a.activity_type = 'BOARD_STAGE_MOVE' and a.detail = 'FOLLOW_UP'))
                 or exists (select 1 from site_visits v, h where v.lead_id = h.lead_id and v.employee_id = h.employee_id and v.event_type in ('VISIT', 'REVISIT') and v.denied_at is null and v.created_at >= h.assigned_at and v.created_at < h.end_at),
    'result', (select a.detail from lead_activity_log a, h where a.lead_id = h.lead_id and a.lead_history_id = h.id and a.activity_type = 'STATUS_UPDATE' order by a.created_at desc, a.id desc limit 1))
$function$

;
