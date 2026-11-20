-- APPLIED (live; exact date not recorded, between 2026-11-15 and 2026-11-20); recorded 2026-11-20; live checked against the function / column definitions. The "NOT APPLIED" wording below is from before the apply; the SQL is unchanged.
-- NOT APPLIED. 2026-11-15. Apply only on the owner's "haan", from an LF copy (git show), BEFORE the frontend merge.
-- Admin bulk Reassign with a server-side limit (Admin Leads page). Until now the 500-lead limit and the confirm step
-- lived only in the UI; bulk_reassign_leads_atomic accepts any number of ids. admin_reassign_leads is the new,
-- additive entry point: Admin only (is_admin(), so super_admin too), reason required, at most 500 distinct leads a
-- call, the receiving employee must exist and be active (else the whole call is refused before anything moves), and
-- one savepoint per lead so one bad lead never stops the others. Each lead goes through force_reassign_lead_atomic,
-- exactly like a single manual reassign (old assignment ends ADMIN_REASSIGNED, new lead_history row by ADMIN,
-- lead_forced_removals row, notification to the receiver). Every move is also recorded in lead_guard_events
-- (source admin_reassign, action ADMIN_REASSIGN). Nothing is dropped or changed: bulk_reassign_leads_atomic and
-- force_reassign_lead_atomic stay as they are. No anon / PUBLIC access.
-- Rollback: 2026-11-15_admin_reassign_leads_rollback.sql.
begin;

create function public.admin_reassign_leads(p_lead_ids uuid[], p_to_employee_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_caller uuid := current_employee_id();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_ids uuid[];
  v_id uuid;
  v_owner uuid;
  v_results jsonb := '[]'::jsonb;
  v_done int := 0;
begin
  if v_caller is null or not coalesce(is_admin(), false) then
    raise exception 'admin_reassign_leads: caller is not an admin';
  end if;
  if v_reason = '' then
    raise exception 'admin_reassign_leads: reason is required';
  end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_lead_ids, '{}'::uuid[])) x where x is not null;
  if v_ids is null then
    raise exception 'admin_reassign_leads: no leads selected';
  end if;
  if cardinality(v_ids) > 500 then
    raise exception 'admin_reassign_leads: at most 500 leads at a time (got %)', cardinality(v_ids);
  end if;
  if p_to_employee_id is null or not exists (select 1 from employees where id = p_to_employee_id and is_active) then
    raise exception 'admin_reassign_leads: the receiving employee is not active';
  end if;

  foreach v_id in array v_ids loop
    begin
      select current_owner_id into v_owner from leads where id = v_id and merged_into_lead_id is null for update;
      if not found then
        v_results := v_results || jsonb_build_object('lead_id', v_id, 'success', false, 'error', 'lead not found');
        continue;
      end if;

      perform force_reassign_lead_atomic(v_id, p_to_employee_id, v_reason);
      perform log_guard_event('admin_reassign', 'ADMIN_REASSIGN', v_id, jsonb_build_object(
        'reason', v_reason, 'by_employee_id', v_caller, 'from_employee_id', v_owner, 'to_employee_id', p_to_employee_id));
      v_done := v_done + 1;
      v_results := v_results || jsonb_build_object('lead_id', v_id, 'success', true);
    exception when others then
      v_results := v_results || jsonb_build_object('lead_id', v_id, 'success', false, 'error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('requested', cardinality(v_ids), 'reassigned', v_done, 'results', v_results);
end;
$fn$;

revoke all on function public.admin_reassign_leads(uuid[], uuid, text) from public, anon;
grant execute on function public.admin_reassign_leads(uuid[], uuid, text) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.admin_reassign_leads(uuid[], uuid, text)', 'EXECUTE') then raise exception 'anon can execute'; end if;
  if not has_function_privilege('authenticated', 'public.admin_reassign_leads(uuid[], uuid, text)', 'EXECUTE') then raise exception 'authenticated cannot execute'; end if;
end $$;

commit;
