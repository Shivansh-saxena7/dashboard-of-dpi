-- NOT APPLIED. 2026-11-15. Apply only on the owner's "haan", from an LF copy (git cat-file -p), rolled-back dry run first,
-- between sweeps, BEFORE the frontend merge.
-- Admin bulk Reassign with a stage mode. Additive: a new 4-parameter overload of admin_reassign_leads; the 3-parameter
-- function (2026-11-15_admin_reassign_leads.sql) stays exactly as it is and keeps resetting every lead.
-- p_stage_mode has NO database default on purpose: with a default, a 3-argument call would match both functions and
-- Postgres would refuse it as ambiguous, breaking the live button the moment this is applied. The UI sends 'auto'.
--   auto  : a positive lead (stage FOLLOW_UP / VISIT / BOOKING, or status CONNECTED / CONVERTED) goes through
--           reassign_keep_state_atomic (status, stage and recycle_count kept, fresh clocks for the new owner, 14-day
--           restore-hold protection); every other lead goes through force_reassign_lead_atomic (reset to NEW / LEADS).
--   keep  : every lead through reassign_keep_state_atomic.
--   reset : every lead through force_reassign_lead_atomic (same as the 3-parameter function).
-- Same rules as before: Admin only (is_admin()), reason required, at most 500 distinct leads, receiver must exist and be
-- active (else nothing moves), one savepoint per lead, every move in lead_guard_events with the mode. The keep-state
-- path keeps its own rules (receiver in the sales department, reason of at least 5 characters); a positive lead that
-- cannot keep its stage fails on its own with a clear message and the other leads still move. No anon / PUBLIC access.
-- Rollback: 2026-11-15_admin_reassign_stage_mode_rollback.sql.
begin;

create function public.admin_reassign_leads(p_lead_ids uuid[], p_to_employee_id uuid, p_reason text, p_stage_mode text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_caller uuid := current_employee_id();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_mode text := lower(btrim(coalesce(p_stage_mode, '')));
  v_ids uuid[];
  v_id uuid;
  v_owner uuid;
  v_status text;
  v_stage text;
  v_positive boolean;
  v_path text;
  v_sales boolean;
  v_keep jsonb;
  v_results jsonb := '[]'::jsonb;
  v_done int := 0;
  v_kept int := 0;
  v_reset int := 0;
begin
  if v_caller is null or not coalesce(is_admin(), false) then
    raise exception 'admin_reassign_leads: caller is not an admin';
  end if;
  if v_reason = '' then
    raise exception 'admin_reassign_leads: reason is required';
  end if;
  if v_mode not in ('auto', 'keep', 'reset') then
    raise exception 'admin_reassign_leads: stage mode must be auto, keep or reset (got %)', coalesce(p_stage_mode, 'null');
  end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_lead_ids, '{}'::uuid[])) x where x is not null;
  if v_ids is null then
    raise exception 'admin_reassign_leads: no leads selected';
  end if;
  if cardinality(v_ids) > 500 then
    raise exception 'admin_reassign_leads: at most 500 leads at a time (got %)', cardinality(v_ids);
  end if;
  select coalesce(department, '') = 'sales' into v_sales from employees where id = p_to_employee_id and is_active;
  if not found then
    raise exception 'admin_reassign_leads: the receiving employee is not active';
  end if;

  foreach v_id in array v_ids loop
    v_path := null;
    begin
      select current_owner_id, status, board_stage into v_owner, v_status, v_stage
        from leads where id = v_id and merged_into_lead_id is null for update;
      if not found then
        v_results := v_results || jsonb_build_object('lead_id', v_id, 'success', false, 'error', 'lead not found');
        continue;
      end if;
      v_positive := coalesce(v_stage, 'LEADS') in ('FOLLOW_UP', 'VISIT', 'BOOKING') or v_status in ('CONNECTED', 'CONVERTED');
      v_path := case when v_mode = 'keep' or (v_mode = 'auto' and v_positive) then 'keep' else 'reset' end;

      if v_path = 'keep' then
        if not v_sales then
          v_results := v_results || jsonb_build_object('lead_id', v_id, 'success', false, 'path', 'keep',
            'error', 'a lead keeps its stage only with a sales employee: choose a sales employee, or Reset all leads to New');
          continue;
        end if;
        v_keep := reassign_keep_state_atomic(v_id, p_to_employee_id, v_reason);
        if v_keep->>'result' = 'ALREADY' then
          v_results := v_results || jsonb_build_object('lead_id', v_id, 'success', false, 'path', 'keep', 'error', 'lead is already assigned to that employee');
          continue;
        elsif v_keep->>'result' = 'HELD' then
          v_results := v_results || jsonb_build_object('lead_id', v_id, 'success', false, 'path', 'keep',
            'error', 'held: a positive copy of this number is with another employee');
          continue;
        elsif v_keep->>'result' is distinct from 'REASSIGNED' then
          raise exception 'unexpected keep-state answer %', v_keep;
        end if;
        -- reassign_keep_state_atomic already wrote its ADMIN_REASSIGN event in this transaction; add the mode to it.
        update lead_guard_events set detail = detail || jsonb_build_object('stage_mode', v_mode, 'path', 'keep')
          where lead_id = v_id and source = 'admin_reassign' and action = 'ADMIN_REASSIGN' and created_at >= now();
        v_kept := v_kept + 1;
      else
        perform force_reassign_lead_atomic(v_id, p_to_employee_id, v_reason);
        perform log_guard_event('admin_reassign', 'ADMIN_REASSIGN', v_id, jsonb_build_object(
          'reason', v_reason, 'by_employee_id', v_caller, 'from_employee_id', v_owner, 'to_employee_id', p_to_employee_id,
          'stage_mode', v_mode, 'path', 'reset', 'previous_status', v_status, 'previous_stage', coalesce(v_stage, 'LEADS')));
        v_reset := v_reset + 1;
      end if;
      v_done := v_done + 1;
      v_results := v_results || jsonb_build_object('lead_id', v_id, 'success', true, 'path', v_path);
    exception when others then
      v_results := v_results || jsonb_build_object('lead_id', v_id, 'success', false, 'path', v_path, 'error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('requested', cardinality(v_ids), 'reassigned', v_done, 'kept', v_kept, 'reset', v_reset,
                            'stage_mode', v_mode, 'results', v_results);
end;
$fn$;

revoke all on function public.admin_reassign_leads(uuid[], uuid, text, text) from public, anon;
grant execute on function public.admin_reassign_leads(uuid[], uuid, text, text) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.admin_reassign_leads(uuid[], uuid, text, text)', 'EXECUTE') then raise exception 'anon can execute'; end if;
  if not has_function_privilege('authenticated', 'public.admin_reassign_leads(uuid[], uuid, text, text)', 'EXECUTE') then raise exception 'authenticated cannot execute'; end if;
  if not exists (select 1 from pg_proc where proname = 'admin_reassign_leads' and pronargs = 3) then raise exception 'the 3-parameter function must stay'; end if;
end $$;

commit;
