-- 2026-11-23 Performance Report: give leads from the report (admin only), with an admin-only batch tag, journey and
-- undo. DRAFT, NOT APPLIED. Apply only on the owner's "haan", AFTER 2026-11-23_perf_report_v3.sql, from an LF copy,
-- after a rolled-back dry run, at least 2 minutes away from a recycle sweep (:00/:15/:30/:45 IST) and the hourly
-- refresh (:37 IST). Rollback: 2026-11-23_perf_report_reassign_rollback.sql. The page shows these controls only while
-- lead_engine_settings.admin_report_reassign_mode = 'on' (separate file, default off).
--
-- Additive: 2 tables, 9 functions (uses perf_stint_facts from the v3 file). Nothing existing changes. Every lead still moves through the existing
-- admin_reassign_leads(ids, to, reason, 'auto') (the Admin Leads page's bulk reassign): positive leads keep their state
-- via reassign_keep_state_atomic (sibling guard, 14-day protection), others reset via force_reassign_lead_atomic; the
-- old stint ends ADMIN_REASSIGNED, the new stint is by ADMIN (the report shows it as "Given by admin"), the receiver
-- gets the existing notification, lead_guard_events / lead_forced_removals keep their audit.
--
-- The admin's reason and label stay in the admin-only batch tables. The existing functions write their reason into the
-- employee's notification and lead_history.reassign_note (shown on the employee's lead card), so this file always
-- passes the fixed text "Given by admin" to them.
--
-- Per lead, before moving (lead row locked): not found / merged / Junk -> skipped; current owner differs from the owner
-- the admin saw -> skipped (owner changed); already with the receiver -> skipped; positive and include_positive off ->
-- skipped (positive excluded); give_back to someone who never had the lead -> skipped. The receiver is checked once
-- (active, Sales, not on leave today, not in return grace) and the whole call is refused if not. At most 200 leads a
-- call (items in the request body). The idempotency key is unique: a repeat returns the first result, moves nothing.
begin;

create table if not exists public.perf_reassign_batches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,                                   -- employees.id of the admin
  mode text not null check (mode in ('give', 'give_back', 'undo')),
  to_employee_id uuid not null,
  from_employee_ids uuid[] not null default '{}',
  reason text not null,
  label text,
  include_positive boolean not null default false,
  requested int not null default 0,
  moved int not null default 0,
  skipped int not null default 0,
  skipped_breakdown jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  undo_of uuid references public.perf_reassign_batches (id),
  undone_by uuid references public.perf_reassign_batches (id),
  result jsonb
);
create table if not exists public.perf_reassign_batch_leads (
  batch_id uuid not null references public.perf_reassign_batches (id) on delete cascade,
  lead_id uuid not null,
  from_employee_id uuid,
  from_stint_id uuid,
  to_employee_id uuid not null,
  new_stint_id uuid,
  status text not null check (status in ('moved', 'skipped')),
  skip_reason text,
  positive boolean not null default false,
  path text,
  created_at timestamptz not null default now(),
  primary key (batch_id, lead_id)
);
create index if not exists perf_reassign_batch_leads_lead_idx on public.perf_reassign_batch_leads (lead_id);
create index if not exists perf_reassign_batches_created_idx on public.perf_reassign_batches (created_at);
alter table public.perf_reassign_batches enable row level security;
alter table public.perf_reassign_batch_leads enable row level security;
revoke all on public.perf_reassign_batches, public.perf_reassign_batch_leads from public, anon, authenticated;
grant select on public.perf_reassign_batches, public.perf_reassign_batch_leads to authenticated;
drop policy if exists perf_reassign_batches_admin_read on public.perf_reassign_batches;
create policy perf_reassign_batches_admin_read on public.perf_reassign_batches for select to authenticated using (coalesce((select is_admin()), false));
drop policy if exists perf_reassign_batch_leads_admin_read on public.perf_reassign_batch_leads;
create policy perf_reassign_batch_leads_admin_read on public.perf_reassign_batch_leads for select to authenticated using (coalesce((select is_admin()), false));

-- Positive now: the same rule admin_reassign_leads uses to keep a lead's state.
create or replace function public.perf_lead_is_positive(p_status text, p_stage text)
returns boolean language sql immutable as $$
  select coalesce(p_stage, 'LEADS') in ('FOLLOW_UP', 'VISIT', 'BOOKING') or coalesce(p_status, '') in ('CONNECTED', 'CONVERTED')
$$;

-- Why a receiver cannot take leads now (null = fine): missing, inactive, not Sales, on leave today, in return grace.
create or replace function public.perf_reassign_receiver_problem(p_employee uuid)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare e record; today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select id, is_active, department into e from employees where id = p_employee;
  if not found then return 'receiver not found'; end if;
  if not e.is_active then return 'receiver is not active'; end if;
  if coalesce(e.department, '') <> 'sales' then return 'receiver is not in Sales'; end if;
  if exists (select 1 from employee_leave_periods l where l.employee_id = p_employee and l.start_date <= today and (l.end_date is null or l.end_date >= today)) then
    return 'receiver is on leave today';
  end if;
  if coalesce(employee_in_return_grace(p_employee, today), false) then return 'receiver is in return grace after leave'; end if;
  return null;
end;
$$;

-- Items must be [{"lead_id": uuid, "expected_owner": uuid|null}], 1 to 200, each lead once. Raises otherwise.
create or replace function public.perf_reassign_check_items(p_items jsonb)
returns void language plpgsql immutable as $$
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'report reassign: between 1 and 200 leads a call'; end if;
  if exists (select 1 from jsonb_array_elements(p_items) i where jsonb_typeof(i) <> 'object'
             or coalesce(i ->> 'lead_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             or (nullif(i ->> 'expected_owner', '') is not null and (i ->> 'expected_owner') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then
    raise exception 'report reassign: every item needs a lead_id (uuid)';
  end if;
  if (select count(distinct lower(i ->> 'lead_id')) from jsonb_array_elements(p_items) i) <> jsonb_array_length(p_items) then
    raise exception 'report reassign: a lead is in the list twice';
  end if;
end;
$$;

-- The give / undo calls work only while the page flag is on (a missing column counts as off).
create or replace function public.perf_reassign_enabled()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select to_jsonb(s) ->> 'admin_report_reassign_mode' from lead_engine_settings s where s.id = 1), 'off') = 'on'
$$;

-- The per-lead verdict (shared by preview and the real call). Expects the lead row already read.
create or replace function public.perf_reassign_verdict(p_lead_id uuid, p_expected_owner uuid, p_to uuid, p_mode text, p_include_positive boolean)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare l record; v_pos boolean;
begin
  select id, current_owner_id, status, board_stage, merged_into_lead_id into l from leads where id = p_lead_id;
  if not found or l.merged_into_lead_id is not null or l.status = 'JUNK' then return jsonb_build_object('ok', false, 'reason', 'not available (missing, merged or junk)'); end if;
  v_pos := perf_lead_is_positive(l.status, l.board_stage);
  if l.current_owner_id is distinct from p_expected_owner then return jsonb_build_object('ok', false, 'reason', 'owner changed since the list was opened', 'positive', v_pos); end if;
  if l.current_owner_id = p_to then return jsonb_build_object('ok', false, 'reason', 'already with this employee', 'positive', v_pos); end if;
  if p_mode = 'give_back' and not exists (select 1 from lead_history h where h.lead_id = p_lead_id and h.employee_id = p_to) then
    return jsonb_build_object('ok', false, 'reason', 'this employee never had the lead', 'positive', v_pos);
  end if;
  if v_pos and not coalesce(p_include_positive, false) then return jsonb_build_object('ok', false, 'reason', 'positive lead (excluded)', 'positive', true); end if;
  return jsonb_build_object('ok', true, 'positive', v_pos);
end;
$$;

-- What would happen, nothing written. Items: [{"lead_id": uuid, "expected_owner": uuid|null}], at most 200.
create or replace function public.admin_report_reassign_preview(p_items jsonb, p_to_employee uuid, p_mode text, p_include_positive boolean)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_item jsonb; v jsonb; v_ok int := 0; v_pos_ex int := 0; v_pos_in int := 0; v_skip jsonb := '{}'::jsonb; v_problem text; v_from jsonb := '{}'::jsonb; v_owner text;
begin
  if not coalesce((select is_admin()), false) then raise exception 'report reassign: admin only'; end if;
  if p_mode not in ('give', 'give_back') then raise exception 'report reassign: mode must be give or give_back'; end if;
  perform perf_reassign_check_items(p_items);
  v_problem := perf_reassign_receiver_problem(p_to_employee);
  for v_item in select value from jsonb_array_elements(p_items) order by (value ->> 'lead_id')::uuid loop
    v := perf_reassign_verdict((v_item ->> 'lead_id')::uuid, nullif(v_item ->> 'expected_owner', '')::uuid, p_to_employee, p_mode, p_include_positive);
    if (v ->> 'ok')::boolean then
      v_ok := v_ok + 1;
      if (v ->> 'positive')::boolean then v_pos_in := v_pos_in + 1; end if;
      v_owner := coalesce(v_item ->> 'expected_owner', 'none');
      v_from := jsonb_set(v_from, array[v_owner], to_jsonb(coalesce((v_from ->> v_owner)::int, 0) + 1));
    else
      if v ->> 'reason' = 'positive lead (excluded)' then v_pos_ex := v_pos_ex + 1; end if;
      v_skip := jsonb_set(v_skip, array[v ->> 'reason'], to_jsonb(coalesce((v_skip ->> (v ->> 'reason'))::int, 0) + 1));
    end if;
  end loop;
  return jsonb_build_object('requested', jsonb_array_length(p_items), 'will_move', case when v_problem is null then v_ok else 0 end,
    'positive_included', v_pos_in, 'positive_excluded', v_pos_ex, 'skipped', v_skip, 'from', v_from, 'receiver_problem', v_problem);
end;
$$;

-- Give (or give back) up to 200 leads. Returns the batch id and per-lead results.
create or replace function public.admin_reassign_leads_from_report(p_items jsonb, p_to_employee uuid, p_mode text, p_reason text, p_label text,
  p_include_positive boolean, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_existing record; v_admin uuid; v_batch uuid; v_item jsonb; v_lead uuid; v_expected uuid; v jsonb; v_from_stint uuid; v_new_stint uuid;
  v_res jsonb; v_moved int := 0; v_skipped int := 0; v_skip jsonb := '{}'::jsonb; v_results jsonb := '[]'::jsonb; v_froms uuid[] := '{}'; v_problem text; v_out jsonb;
begin
  if not coalesce((select is_admin()), false) then raise exception 'report reassign: admin only'; end if;
  if p_mode not in ('give', 'give_back') then raise exception 'report reassign: mode must be give or give_back'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'report reassign: a reason of at least 5 characters is needed'; end if;
  if length(coalesce(p_idempotency_key, '')) < 8 then raise exception 'report reassign: idempotency key needed'; end if;
  perform perf_reassign_check_items(p_items);
  select * into v_existing from perf_reassign_batches where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.mode not in ('give', 'give_back') or v_existing.mode <> p_mode or v_existing.to_employee_id <> p_to_employee then
      raise exception 'report reassign: idempotency key already used for another action';
    end if;
    return coalesce(v_existing.result, '{}'::jsonb) || jsonb_build_object('repeat', true);
  end if;
  if not perf_reassign_enabled() then raise exception 'report reassign: turned off (admin_report_reassign_mode)'; end if;
  v_problem := perf_reassign_receiver_problem(p_to_employee);
  if v_problem is not null then raise exception 'report reassign: %', v_problem; end if;
  select id into v_admin from employees where auth_user_id = auth.uid() limit 1;
  begin
    insert into perf_reassign_batches (created_by, mode, to_employee_id, reason, label, include_positive, requested, idempotency_key)
    values (v_admin, p_mode, p_to_employee, btrim(p_reason), nullif(btrim(coalesce(p_label, '')), ''), coalesce(p_include_positive, false), jsonb_array_length(p_items), p_idempotency_key)
    returning id into v_batch;
  exception when unique_violation then
    select * into v_existing from perf_reassign_batches where idempotency_key = p_idempotency_key;
    if v_existing.mode not in ('give', 'give_back') or v_existing.mode <> p_mode or v_existing.to_employee_id <> p_to_employee then
      raise exception 'report reassign: idempotency key already used for another action';
    end if;
    return coalesce(v_existing.result, '{}'::jsonb) || jsonb_build_object('repeat', true);
  end;
  for v_item in select value from jsonb_array_elements(p_items) order by (value ->> 'lead_id')::uuid loop  -- fixed lock order
    v_lead := (v_item ->> 'lead_id')::uuid;
    v_expected := nullif(v_item ->> 'expected_owner', '')::uuid;
    perform 1 from leads where id = v_lead for update;  -- the sweep cannot move it while we check and move
    v := perf_reassign_verdict(v_lead, v_expected, p_to_employee, p_mode, p_include_positive);
    select id into v_from_stint from lead_history where lead_id = v_lead and is_active order by assigned_at desc limit 1;
    if (v ->> 'ok')::boolean then
      begin
        v_res := admin_reassign_leads(array[v_lead], p_to_employee, 'Given by admin', 'auto') -> 'results' -> 0;
        if coalesce((v_res ->> 'success')::boolean, false) then
          select id into v_new_stint from lead_history where lead_id = v_lead and is_active order by assigned_at desc limit 1;
          insert into perf_reassign_batch_leads (batch_id, lead_id, from_employee_id, from_stint_id, to_employee_id, new_stint_id, status, positive, path)
          values (v_batch, v_lead, v_expected, v_from_stint, p_to_employee, v_new_stint, 'moved', (v ->> 'positive')::boolean, v_res ->> 'path');
          v_moved := v_moved + 1;
          if v_expected is not null and not (v_expected = any (v_froms)) then v_froms := v_froms || v_expected; end if;
          v_results := v_results || jsonb_build_object('lead_id', v_lead, 'status', 'moved', 'path', v_res ->> 'path');
          continue;
        end if;
        v := jsonb_build_object('ok', false, 'reason', coalesce(v_res ->> 'error', 'refused'), 'positive', v -> 'positive');
      exception when others then
        v := jsonb_build_object('ok', false, 'reason', sqlerrm, 'positive', v -> 'positive');
      end;
    end if;
    insert into perf_reassign_batch_leads (batch_id, lead_id, from_employee_id, from_stint_id, to_employee_id, status, skip_reason, positive)
    values (v_batch, v_lead, v_expected, v_from_stint, p_to_employee, 'skipped', v ->> 'reason', coalesce((v ->> 'positive')::boolean, false))
    on conflict (batch_id, lead_id) do nothing;
    v_skipped := v_skipped + 1;
    v_skip := jsonb_set(v_skip, array[v ->> 'reason'], to_jsonb(coalesce((v_skip ->> (v ->> 'reason'))::int, 0) + 1));
    v_results := v_results || jsonb_build_object('lead_id', v_lead, 'status', 'skipped', 'reason', v ->> 'reason');
  end loop;
  v_out := jsonb_build_object('batch_id', v_batch, 'requested', jsonb_array_length(p_items), 'moved', v_moved, 'skipped', v_skipped, 'skipped_breakdown', v_skip, 'results', v_results);
  update perf_reassign_batches set moved = v_moved, skipped = v_skipped, skipped_breakdown = v_skip, from_employee_ids = v_froms, result = v_out where id = v_batch;
  return v_out;
end;
$$;

-- Undo a give / give_back batch (owner: within 7 days): each moved lead goes back to its previous owner only if nothing happened since (same
-- owner, same assignment, no result / stage move / visit on it). Same guards and path as a give.
create or replace function public.admin_undo_report_batch(p_batch_id uuid, p_reason text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  b record; r record; v_existing record; v_admin uuid; v_undo uuid; v_res jsonb; v_cur uuid; v_active uuid; v_moved int := 0; v_skipped int := 0;
  v_skip jsonb := '{}'::jsonb; v_reason text; v_problem text; v_new uuid; v_out jsonb;
begin
  if not coalesce((select is_admin()), false) then raise exception 'report reassign: admin only'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'report reassign: a reason of at least 5 characters is needed'; end if;
  if length(coalesce(p_idempotency_key, '')) < 8 then raise exception 'report reassign: idempotency key needed'; end if;
  select * into v_existing from perf_reassign_batches where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.mode <> 'undo' or v_existing.undo_of is distinct from p_batch_id then
      raise exception 'report reassign: idempotency key already used for another action';
    end if;
    return coalesce(v_existing.result, '{}'::jsonb) || jsonb_build_object('repeat', true);
  end if;
  select * into b from perf_reassign_batches where id = p_batch_id for update;
  if not found or b.mode = 'undo' then raise exception 'report reassign: no such give batch'; end if;
  if not perf_reassign_enabled() then raise exception 'report reassign: turned off (admin_report_reassign_mode)'; end if;
  if b.undone_by is not null then raise exception 'report reassign: this batch was already undone'; end if;
  if b.created_at < now() - interval '7 days' then raise exception 'report reassign: undo is possible for 7 days after a batch'; end if;
  select id into v_admin from employees where auth_user_id = auth.uid() limit 1;
  insert into perf_reassign_batches (created_by, mode, to_employee_id, reason, label, include_positive, requested, idempotency_key, undo_of)
  values (v_admin, 'undo', b.to_employee_id, btrim(p_reason), b.label, true, b.moved, p_idempotency_key, b.id) returning id into v_undo;
  for r in select * from perf_reassign_batch_leads where batch_id = b.id and status = 'moved' order by lead_id loop
    v_reason := null;
    select current_owner_id into v_cur from leads where id = r.lead_id for update;
    select id into v_active from lead_history where lead_id = r.lead_id and is_active order by assigned_at desc limit 1;
    if r.from_employee_id is null then v_reason := 'no previous owner to give back to';
    elsif v_cur is distinct from r.to_employee_id or v_active is distinct from r.new_stint_id then v_reason := 'moved again since the batch';
    elsif exists (select 1 from lead_activity_log a where a.lead_id = r.lead_id and a.lead_history_id = r.new_stint_id and a.activity_type in ('STATUS_UPDATE', 'BOARD_STAGE_MOVE'))
       or exists (select 1 from lead_history h where h.id = r.new_stint_id and coalesce(h.call_count, 0) > 0)
       or exists (select 1 from lead_notes n where n.lead_history_id = r.new_stint_id)
       or exists (select 1 from contact_click_log c where c.lead_history_id = r.new_stint_id)
       or exists (select 1 from site_visits v where v.lead_id = r.lead_id and v.employee_id = r.to_employee_id and v.created_at >= r.created_at) then
      v_reason := 'the new owner already worked on it';
    else
      v_problem := perf_reassign_receiver_problem(r.from_employee_id);
      if v_problem is not null then v_reason := 'previous owner: ' || v_problem; end if;
    end if;
    if v_reason is null then
      begin
        v_res := admin_reassign_leads(array[r.lead_id], r.from_employee_id, 'Given by admin', 'auto') -> 'results' -> 0;
        if coalesce((v_res ->> 'success')::boolean, false) then
          select id into v_new from lead_history where lead_id = r.lead_id and is_active order by assigned_at desc limit 1;
          insert into perf_reassign_batch_leads (batch_id, lead_id, from_employee_id, from_stint_id, to_employee_id, new_stint_id, status, positive, path)
          values (v_undo, r.lead_id, r.to_employee_id, r.new_stint_id, r.from_employee_id, v_new, 'moved', r.positive, v_res ->> 'path');
          v_moved := v_moved + 1;
          continue;
        end if;
        v_reason := coalesce(v_res ->> 'error', 'refused');
      exception when others then v_reason := sqlerrm;
      end;
    end if;
    insert into perf_reassign_batch_leads (batch_id, lead_id, from_employee_id, from_stint_id, to_employee_id, status, skip_reason, positive)
    values (v_undo, r.lead_id, r.to_employee_id, r.new_stint_id, coalesce(r.from_employee_id, r.to_employee_id), 'skipped', v_reason, r.positive);
    v_skipped := v_skipped + 1;
    v_skip := jsonb_set(v_skip, array[v_reason], to_jsonb(coalesce((v_skip ->> v_reason)::int, 0) + 1));
  end loop;
  v_out := jsonb_build_object('batch_id', v_undo, 'undo_of', b.id, 'requested', b.moved, 'moved', v_moved, 'skipped', v_skipped, 'skipped_breakdown', v_skip);
  update perf_reassign_batches set moved = v_moved, skipped = v_skipped, skipped_breakdown = v_skip, result = v_out where id = v_undo;
  update perf_reassign_batches set undone_by = v_undo where id = b.id;
  return v_out;
end;
$$;

-- The admin batches that touched one lead (admin only), for the journey view: when, who, from / to, reason, label.
create or replace function public.get_lead_report_batches(p_lead_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not coalesce((select is_admin()), false) then raise exception 'report reassign: admin only'; end if;
  return jsonb_build_object('lead_id', p_lead_id, 'batches', coalesce((select jsonb_agg(jsonb_build_object('batch_id', b.id, 'at', b.created_at, 'mode', b.mode, 'label', b.label, 'reason', b.reason,
        'from_employee_id', bl.from_employee_id, 'from_name', fe.name, 'to_employee_id', bl.to_employee_id, 'to_name', te.name, 'status', bl.status,
        'skip_reason', bl.skip_reason, 'new_stint_id', bl.new_stint_id) order by b.created_at)
      from perf_reassign_batch_leads bl join perf_reassign_batches b on b.id = bl.batch_id
      left join employees fe on fe.id = bl.from_employee_id left join employees te on te.id = bl.to_employee_id where bl.lead_id = p_lead_id), '[]'::jsonb));
end;
$$;

-- Batches in a date range (IST days), newest first, at most 200.
create or replace function public.get_report_batches(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not coalesce((select is_admin()), false) then raise exception 'report reassign: admin only'; end if;
  return coalesce((select jsonb_agg(x order by x ->> 'created_at' desc) from (
    select jsonb_build_object('batch_id', b.id, 'created_at', b.created_at, 'mode', b.mode, 'label', b.label, 'reason', b.reason, 'to_employee_id', b.to_employee_id,
      'to_name', te.name, 'from_employee_ids', b.from_employee_ids, 'moved', b.moved, 'skipped', b.skipped, 'undo_of', b.undo_of, 'undone_by', b.undone_by, 'by_name', ae.name) x
    from perf_reassign_batches b left join employees te on te.id = b.to_employee_id left join employees ae on ae.id = b.created_by
    where b.created_at >= (p_from::timestamp at time zone 'Asia/Kolkata') and b.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Kolkata')
    order by b.created_at desc limit 200) z), '[]'::jsonb);
end;
$$;

-- Before / after for one batch: what the previous owner did with the moved leads, and what the receiver did since,
-- plus every lead of the batch (moved or skipped) for the batch view.
create or replace function public.get_report_batch_outcome(p_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare b record;
begin
  if not coalesce((select is_admin()), false) then raise exception 'report reassign: admin only'; end if;
  select * into b from perf_reassign_batches where id = p_batch_id;
  if not found then raise exception 'report reassign: no such batch'; end if;
  return (with m as (
      select bl.*, perf_stint_facts(bl.from_stint_id) as bf, perf_stint_facts(bl.new_stint_id) as af
      from perf_reassign_batch_leads bl where bl.batch_id = p_batch_id and bl.status = 'moved'),
    side as (
      select 'before' as side, count(*) as leads, count(*) filter (where (bf ->> 'followup')::boolean) as followup, count(*) filter (where (bf ->> 'visit')::boolean) as visit,
        count(*) filter (where (bf ->> 'connected')::boolean) as connected, count(*) filter (where (bf ->> 'converted')::boolean) as converted, count(*) filter (where bf ->> 'result' is null) as no_result from m
      union all
      select 'after', count(*), count(*) filter (where (af ->> 'followup')::boolean), count(*) filter (where (af ->> 'visit')::boolean),
        count(*) filter (where (af ->> 'connected')::boolean), count(*) filter (where (af ->> 'converted')::boolean), count(*) filter (where af ->> 'result' is null) from m)
    select jsonb_build_object('batch', jsonb_build_object('batch_id', b.id, 'created_at', b.created_at, 'mode', b.mode, 'label', b.label, 'reason', b.reason,
        'to_employee_id', b.to_employee_id, 'to_name', (select name from employees where id = b.to_employee_id), 'from_employee_ids', b.from_employee_ids,
        'from_names', (select jsonb_agg(name) from employees where id = any (b.from_employee_ids)), 'moved', b.moved, 'skipped', b.skipped,
        'skipped_breakdown', b.skipped_breakdown, 'undo_of', b.undo_of, 'undone_by', b.undone_by),
      'before', (select to_jsonb(x) - 'side' from side x where x.side = 'before'), 'after', (select to_jsonb(x) - 'side' from side x where x.side = 'after'),
      'leads', coalesce((select jsonb_agg(jsonb_build_object('lead_id', bl.lead_id, 'lead_name', l.name, 'status', bl.status, 'skip_reason', bl.skip_reason, 'positive', bl.positive,
          'from_employee_id', bl.from_employee_id, 'current_owner_id', l.current_owner_id, 'before', perf_stint_facts(bl.from_stint_id), 'after', perf_stint_facts(bl.new_stint_id)) order by bl.status, bl.lead_id)
        from perf_reassign_batch_leads bl left join leads l on l.id = bl.lead_id where bl.batch_id = p_batch_id), '[]'::jsonb)));
end;
$$;

-- Internal helpers have no admin check of their own: nobody but the admin-checked functions below may call them
-- (live default privileges would otherwise grant authenticated).
revoke all on function public.perf_lead_is_positive(text, text), public.perf_reassign_receiver_problem(uuid),
  public.perf_reassign_verdict(uuid, uuid, uuid, text, boolean), public.perf_reassign_check_items(jsonb), public.perf_reassign_enabled()
  from public, anon, authenticated;
revoke all on function public.admin_report_reassign_preview(jsonb, uuid, text, boolean),
  public.admin_reassign_leads_from_report(jsonb, uuid, text, text, text, boolean, text), public.admin_undo_report_batch(uuid, text, text),
  public.get_lead_report_batches(uuid), public.get_report_batches(date, date), public.get_report_batch_outcome(uuid) from public, anon;
grant execute on function public.admin_report_reassign_preview(jsonb, uuid, text, boolean),
  public.admin_reassign_leads_from_report(jsonb, uuid, text, text, text, boolean, text), public.admin_undo_report_batch(uuid, text, text),
  public.get_lead_report_batches(uuid), public.get_report_batches(date, date), public.get_report_batch_outcome(uuid) to authenticated;

commit;
