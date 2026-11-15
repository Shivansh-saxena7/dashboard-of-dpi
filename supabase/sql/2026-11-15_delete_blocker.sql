-- DRAFT / NOT APPLIED. 2026-11-15. Proposal only: apply only on the owner's "haan", from an LF copy, after a
-- rolled-back dry run, between sweeps.
-- Delete blocker for employees and leads. 128 foreign keys point at these two tables (108 at employees, 20 at leads).
-- Most are NO ACTION (a delete with history just fails), but 6 are ON DELETE CASCADE and silently delete real data:
-- tracking (GPS) for an employee; lead_history, lead_notes, site_visits, booking_requests, lead_duplicate_overrides
-- for a lead. This adds a BEFORE DELETE trigger on both tables that counts every referencing row (read from
-- pg_constraint at delete time, so a future FK is covered automatically) and refuses the delete when anything links
-- to the row, with a 23503 error that names the first table (lib/fkErrorMessage.ts already turns that into "...
-- Deactivate the employee instead of deleting."). Allowed without force:
--   * a row with no linked data at all (a mistaken / empty employee or lead);
--   * an untouched CSV-import lead (the same "not worked on" rule delete_csv_batch_atomic already enforces), so
--     deleting an import batch keeps working.
-- Force: admin_force_delete(table, id, reason), Super Admin only, reason required, records the counts in
-- system_anomaly_log first. Force only skips this trigger: the NO ACTION foreign keys still refuse, so force can
-- never leave a dangling reference; on a lead it means the CASCADE history is deleted on purpose.
-- Additive: nothing existing is dropped or replaced. Rollback: 2026-11-15_delete_blocker_rollback.sql.
begin;

-- Rows in every table that references p_table, per referencing column; only columns with at least one row.
create function public.delete_blocker_counts(p_table regclass, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  r record;
  n bigint;
  v jsonb := '{}'::jsonb;
begin
  for r in
    select c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = p_table and cardinality(c.conkey) = 1
    order by 1, 2
  loop
    execute format('select count(*) from %s where %I = $1', r.tbl, r.col) into n using p_id;
    if n > 0 then
      v := v || jsonb_build_object(r.tbl::text || '.' || r.col, n);
    end if;
  end loop;
  return v;
end;
$fn$;

create function public.block_unsafe_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_counts jsonb;
  v_first text;
begin
  -- admin_force_delete sets this to its own transaction id; nothing else can (it is checked against this transaction).
  if current_setting('app.force_delete_txid', true) = txid_current()::text then
    return old;
  end if;

  -- Untouched CSV-import lead: the rule delete_csv_batch_atomic already applies before it deletes.
  -- Nested IF: old.csv_import_batch_id exists only on leads, so it is never read for an employees row.
  if tg_table_name = 'leads' then
    if old.csv_import_batch_id is not null
       and old.board_stage is not distinct from 'LEADS'
       and (select count(*) from lead_history h where h.lead_id = old.id) <= 1
       and not exists (select 1 from lead_history h where h.lead_id = old.id and h.outcome_at is not null)
       and not exists (select 1 from lead_notes n where n.lead_id = old.id)
       and not exists (select 1 from site_visits s where s.lead_id = old.id) then
      return old;
    end if;
  end if;

  v_counts := delete_blocker_counts(tg_relid::regclass, old.id);
  if v_counts = '{}'::jsonb then
    return old;
  end if;

  select split_part(k, '.', 1) into v_first from jsonb_object_keys(v_counts) k limit 1;
  raise exception using
    errcode = '23503',
    message = format('update or delete on table "%s" violates foreign key constraint "delete_blocker" on table "%s"', tg_table_name, v_first),
    detail = 'Linked rows: ' || v_counts::text,
    hint = 'Deactivate instead of deleting, or use admin_force_delete with a reason.';
end;
$fn$;

create trigger employees_delete_blocker before delete on public.employees
  for each row execute function public.block_unsafe_delete();
create trigger leads_delete_blocker before delete on public.leads
  for each row execute function public.block_unsafe_delete();

-- Explicit, recorded force delete (Super Admin only). Returns what was linked.
create function public.admin_force_delete(p_table text, p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_counts jsonb;
begin
  if coalesce(current_employee_role(), '') <> 'super_admin' then
    raise exception 'admin_force_delete: only a Super Admin can force a delete';
  end if;
  if p_table not in ('employees', 'leads') then
    raise exception 'admin_force_delete: table must be employees or leads';
  end if;
  if v_reason = '' then
    raise exception 'admin_force_delete: reason is required';
  end if;

  v_counts := delete_blocker_counts(('public.' || p_table)::regclass, p_id);
  insert into system_anomaly_log (source, severity, message, context)
  values ('admin_force_delete:' || p_table, 'warning',
    format('Force delete of one %s row by a Super Admin: %s', rtrim(p_table, 's'), v_reason),
    jsonb_build_object('id', p_id, 'by_employee_id', current_employee_id(), 'linked', v_counts));

  perform set_config('app.force_delete_txid', txid_current()::text, true);
  execute format('delete from public.%I where id = $1', p_table) using p_id;
  if not found then
    raise exception 'admin_force_delete: % % not found', p_table, p_id;
  end if;
  perform set_config('app.force_delete_txid', '', true);
  return jsonb_build_object('deleted', true, 'linked', v_counts);
end;
$fn$;

revoke all on function public.delete_blocker_counts(regclass, uuid) from public, anon;
grant execute on function public.delete_blocker_counts(regclass, uuid) to authenticated, service_role;
revoke all on function public.block_unsafe_delete() from public, anon, authenticated;
revoke all on function public.admin_force_delete(text, uuid, text) from public, anon;
grant execute on function public.admin_force_delete(text, uuid, text) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.admin_force_delete(text, uuid, text)', 'EXECUTE') then raise exception 'anon can execute admin_force_delete'; end if;
  if has_function_privilege('anon', 'public.delete_blocker_counts(regclass, uuid)', 'EXECUTE') then raise exception 'anon can execute delete_blocker_counts'; end if;
  if (select count(*) from pg_trigger where tgname in ('employees_delete_blocker', 'leads_delete_blocker')) <> 2 then raise exception 'triggers missing'; end if;
end $$;

commit;
