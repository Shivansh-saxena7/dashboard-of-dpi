-- NOT APPLIED. 2026-11-13. Apply only on the owner's "haan", from an LF copy (git show), BEFORE the frontend merge.
-- Admin bulk "Mark as junk" for leads that are still active (Admin Leads page). Admin only (is_admin()), reason
-- required, at most 50 leads a call, one savepoint per lead so one bad lead never stops the others. Each lead goes
-- through mark_lead_junk_atomic (the same junk path as the sweep: lead -> JUNK, its active assignment ends with
-- ended_reason JUNK, Admins notified); because the caller is an Admin, the sweep-only auto-junk / positive guards do
-- not apply: this is a person's decision, not the system's. The ended assignment carries the reason in reassign_note
-- (the Admin history modal shows it as "Reason: ...") and every junk is recorded in lead_guard_events
-- (source admin_junk, action ADMIN_JUNK). No anon / PUBLIC access. Rollback: 2026-11-13_admin_mark_leads_junk_rollback.sql.
begin;

create function public.admin_mark_leads_junk(p_lead_ids uuid[], p_reason text)
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
  v_hist uuid;
  v_owner uuid;
  v_status text;
  v_results jsonb := '[]'::jsonb;
  v_done int := 0;
begin
  if v_caller is null or not coalesce(is_admin(), false) then
    raise exception 'admin_mark_leads_junk: caller is not an admin';
  end if;
  if v_reason = '' then
    raise exception 'admin_mark_leads_junk: reason is required';
  end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_lead_ids, '{}'::uuid[])) x where x is not null;
  if v_ids is null then
    raise exception 'admin_mark_leads_junk: no leads selected';
  end if;
  if cardinality(v_ids) > 50 then
    raise exception 'admin_mark_leads_junk: at most 50 leads at a time (got %)', cardinality(v_ids);
  end if;

  foreach v_id in array v_ids loop
    begin
      select status, current_owner_id into v_status, v_owner
        from leads where id = v_id and merged_into_lead_id is null for update;
      if not found then
        v_results := v_results || jsonb_build_object('lead_id', v_id, 'success', false, 'error', 'lead not found');
        continue;
      end if;
      if v_status = 'JUNK' then
        v_results := v_results || jsonb_build_object('lead_id', v_id, 'success', false, 'error', 'already junk');
        continue;
      end if;
      select id into v_hist from lead_history where lead_id = v_id and is_active for update;
      if v_hist is null then
        v_results := v_results || jsonb_build_object('lead_id', v_id, 'success', false, 'error', 'no active assignment');
        continue;
      end if;

      perform mark_lead_junk_atomic(v_id, v_hist, 'Admin: ' || v_reason);
      if (select status from leads where id = v_id) is distinct from 'JUNK' then
        v_results := v_results || jsonb_build_object('lead_id', v_id, 'success', false, 'error', 'junk was refused');
        continue;
      end if;

      update lead_history set reassign_note = 'Marked junk by admin: ' || v_reason where id = v_hist;
      perform log_guard_event('admin_junk', 'ADMIN_JUNK', v_id, jsonb_build_object(
        'reason', v_reason, 'by_employee_id', v_caller, 'lead_owner_id', v_owner,
        'lead_history_id', v_hist, 'previous_status', v_status));
      v_done := v_done + 1;
      v_results := v_results || jsonb_build_object('lead_id', v_id, 'success', true);
    exception when others then
      v_results := v_results || jsonb_build_object('lead_id', v_id, 'success', false, 'error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('requested', cardinality(v_ids), 'junked', v_done, 'results', v_results);
end;
$fn$;

revoke all on function public.admin_mark_leads_junk(uuid[], text) from public, anon;
grant execute on function public.admin_mark_leads_junk(uuid[], text) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.admin_mark_leads_junk(uuid[], text)', 'EXECUTE') then raise exception 'anon can execute'; end if;
  if not has_function_privilege('authenticated', 'public.admin_mark_leads_junk(uuid[], text)', 'EXECUTE') then raise exception 'authenticated cannot execute'; end if;
end $$;

commit;
