-- 2026-10-16 — P4 safety layers. NOT APPLIED. Apply only after an explicit "haan".
-- Rollback: 2026-10-16_p4_safety_layers_rollback.sql
--
-- 1. Kill switches + junk circuit breaker settings (read by recycle-stale-leads
--    via lib/autoJunkGuard.ts; the function already treats missing columns as
--    "on / cap 20", so applying this changes nothing until a value is edited).
-- 2. Distribution Guard — SHADOW mode only: an AFTER trigger that logs (never
--    blocks) when a lead is handed to someone while the same number is open
--    with another employee in FOLLOW_UP or VISIT (any project). Errors inside
--    the trigger are swallowed, so it cannot break an assignment.
-- 3. Nightly lead-integrity checks -> system_anomaly_log (shown on
--    /admin/system-health), scheduled 21:00 IST.
--
-- Not needed (checked live 2026-10-16): leads.mobile_normalized is already a
-- GENERATED column (right(digits, 10)), and create_manual_lead_atomic (Catcher
-- add) already runs lead_conflicts_core with an Admin-override path.

begin;

-- 1 ---------------------------------------------------------------------------
alter table lead_engine_settings
  add column if not exists auto_junk_enabled boolean not null default true,
  add column if not exists auto_recycle_enabled boolean not null default true,
  add column if not exists max_auto_junk_per_sweep integer not null default 20,
  add column if not exists distribution_guard_mode text not null default 'shadow'
    check (distribution_guard_mode in ('off', 'shadow'));

-- 2 ---------------------------------------------------------------------------
-- The open lead (other than p_lead_id) with the same number that is in
-- FOLLOW_UP or VISIT (stage, or a visit pause) with an active employee.
create or replace function public.distribution_guard_holder(p_lead_id uuid, p_mobile_normalized text)
returns table (holder_lead_id uuid, holder_owner_id uuid, holder_stage text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select l.id, l.current_owner_id,
         case when h.pause_reason like 'VISIT%' then 'VISIT' else l.board_stage end
  from leads l
  join employees e on e.id = l.current_owner_id and e.is_active
  left join lead_history h on h.lead_id = l.id and h.is_active
  where p_mobile_normalized ~ '^[0-9]{10}$'
    and l.mobile_normalized = p_mobile_normalized
    and l.id <> p_lead_id
    and l.status <> 'JUNK'
    and l.merged_into_lead_id is null
    and (l.board_stage in ('FOLLOW_UP', 'VISIT') or h.pause_reason in ('VISIT_LOCK', 'VISIT_PENDING_VERIFICATION'))
  order by (l.board_stage = 'VISIT' or h.pause_reason like 'VISIT%') desc, l.created_at
  limit 1;
$function$;

create or replace function public.distribution_guard_shadow_log()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_mode text;
  v_holder record;
begin
  select distribution_guard_mode into v_mode from lead_engine_settings where id = 1;
  if coalesce(v_mode, 'off') <> 'shadow' then
    return null;
  end if;
  select * into v_holder from distribution_guard_holder(new.id, new.mobile_normalized);
  if v_holder.holder_lead_id is not null and v_holder.holder_owner_id is distinct from new.current_owner_id then
    perform log_anomaly('distribution_guard_shadow', 'warning',
      format('Would block: lead %s went to another employee while the same number is in %s with someone else (%s)',
        left(new.id::text, 8), v_holder.holder_stage, left(v_holder.holder_lead_id::text, 8)),
      jsonb_build_object('lead_id8', left(new.id::text, 8), 'new_owner_id', new.current_owner_id, 'lead_type', new.lead_type,
        'holder_lead_id8', left(v_holder.holder_lead_id::text, 8), 'holder_owner_id', v_holder.holder_owner_id,
        'holder_stage', v_holder.holder_stage, 'mobile_last4', right(new.mobile_normalized, 4), 'op', tg_op));
  end if;
  return null;
exception when others then
  raise warning 'distribution_guard_shadow_log failed: %', sqlerrm;
  return null;
end;
$function$;

drop trigger if exists leads_distribution_guard_shadow on leads;
create trigger leads_distribution_guard_shadow
  after insert or update of current_owner_id on leads
  for each row
  when (new.current_owner_id is not null)
  execute function distribution_guard_shadow_log();

-- 3 ---------------------------------------------------------------------------
create or replace function public.run_lead_integrity_checks()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_dup int; v_junk int; v_junk_p95 numeric; v_trap int; v_orphan int;
begin
  -- new LEAD duplicate groups (same number + project, 2+ open, one created in the last 24h)
  select count(*) into v_dup from (
    select l.mobile_normalized, lower(btrim(coalesce(l.project, '')))
    from leads l
    where l.lead_type = 'LEAD' and l.status <> 'JUNK' and l.merged_into_lead_id is null and l.mobile_normalized ~ '^[0-9]{10}$'
    group by 1, 2
    having count(*) > 1 and max(l.created_at) > now() - interval '24 hours') g;
  if v_dup > 0 then
    perform log_anomaly('integrity_new_duplicate_groups', 'warning', format('%s new LEAD duplicate group(s) in the last 24h', v_dup), jsonb_build_object('groups', v_dup));
  end if;

  -- auto-junk spike: last 24h vs the daily p95 of the previous 30 days
  select count(*) into v_junk from leads l
  where l.status = 'JUNK' and l.merged_into_lead_id is null and l.updated_at > now() - interval '24 hours'
    and exists (select 1 from lead_history h where h.lead_id = l.id and h.ended_reason = 'JUNK' and not h.is_active);
  select percentile_cont(0.95) within group (order by n) into v_junk_p95 from (
    select date_trunc('day', l.updated_at) d, count(*) n from leads l
    where l.status = 'JUNK' and l.merged_into_lead_id is null
      and l.updated_at between now() - interval '31 days' and now() - interval '24 hours'
      and exists (select 1 from lead_history h where h.lead_id = l.id and h.ended_reason = 'JUNK')
    group by 1) x;
  if v_junk > greatest(coalesce(v_junk_p95, 0) * 1.5, 30) then
    perform log_anomaly('integrity_junk_spike', 'error', format('%s leads junked in the last 24h (30-day daily p95: %s)', v_junk, round(coalesce(v_junk_p95, 0))),
      jsonb_build_object('junked_24h', v_junk, 'p95', v_junk_p95));
  end if;

  -- 3rd-recycle trap pattern: rc>=3 junked within 30 min of a SYSTEM assignment
  select count(*) into v_trap from leads l
  join lateral (select * from lead_history x where x.lead_id = l.id order by x.assigned_at desc limit 1) h on true
  where l.status = 'JUNK' and l.merged_into_lead_id is null and l.recycle_count >= 3 and h.ended_reason = 'JUNK'
    and h.assigned_by_type = 'SYSTEM' and l.updated_at > now() - interval '24 hours' and l.updated_at - h.assigned_at < interval '30 minutes';
  if v_trap > 0 then
    perform log_anomaly('integrity_recycle_junk_trap', 'error', format('%s lead(s) junked within 30 min of their 3rd recycle', v_trap), jsonb_build_object('leads', v_trap));
  end if;

  -- open, owned leads with no active assignment (would vanish from the owner's list)
  select count(*) into v_orphan from leads l
  where l.status <> 'JUNK' and l.merged_into_lead_id is null and l.current_owner_id is not null
    and not exists (select 1 from lead_history h where h.lead_id = l.id and h.is_active);
  if v_orphan > 0 then
    perform log_anomaly('integrity_no_active_assignment', 'error', format('%s open lead(s) have an owner but no active assignment', v_orphan), jsonb_build_object('leads', v_orphan));
  end if;

  return jsonb_build_object('new_duplicate_groups', v_dup, 'junked_24h', v_junk, 'junk_p95', v_junk_p95, 'trap', v_trap, 'no_active_assignment', v_orphan);
end;
$function$;

revoke all on function public.run_lead_integrity_checks() from public, anon, authenticated;
revoke all on function public.distribution_guard_holder(uuid, text) from public, anon, authenticated;

select cron.schedule('lead-integrity-nightly', '30 15 * * *', $$select public.run_lead_integrity_checks()$$);

commit;
