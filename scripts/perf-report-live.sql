-- Read-only parity export for the Admin Performance Report (2026-11-20): last full month (IST), counts only.
-- Run: npx supabase db query --remote --read-only -f scripts/perf-report-live.sql > <export>; then
--      node scripts/parity-perf-report.js --live <export>; delete the export afterwards.
-- The stint rules below are the same as perf_refresh in supabase/sql/2026-11-20_perf_report.sql (the snapshot table
-- is not live yet, so they are computed here directly).
with b as (
  select (date_trunc('month', now() at time zone 'Asia/Kolkata') - interval '1 month') at time zone 'Asia/Kolkata' as f,
         date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as t
),
h as (
  select h.*, row_number() over (partition by h.lead_id order by h.assigned_at, h.created_at, h.id) as n
  from lead_history h
),
st as (
  select h.lead_id, h.employee_id,
    case when h.assigned_by_type = 'SELF' then 'SELF'
         when h.n = 1 then 'FRESH'
         when h.recycle_reason is not null then 'RECYCLED'
         when exists (select 1 from lead_restore_log r where r.lead_id = h.lead_id and r.new_lead_history_id = h.id) then 'RESTORED'
         when h.assigned_by_type = 'ADMIN' then 'ADMIN_GIVEN'
         else 'OTHER' end as origin
  from h, b where h.assigned_at >= b.f and h.assigned_at < b.t
)
select json_build_object(
  'month', (select to_char(f at time zone 'Asia/Kolkata', 'YYYY-MM') from b),
  'report', (select json_build_object(
      'stints', count(*), 'leads', count(distinct lead_id),
      'recycled_stints', count(*) filter (where origin = 'RECYCLED'),
      'recycled_leads', count(distinct lead_id) filter (where origin = 'RECYCLED'),
      'fresh_leads', count(distinct lead_id) filter (where origin = 'FRESH'),
      'restored_leads', count(distinct lead_id) filter (where origin = 'RESTORED'),
      'admin_given_leads', count(distinct lead_id) filter (where origin = 'ADMIN_GIVEN'),
      'employees', count(distinct employee_id)) from st),
  -- System Health / Lead engine "recycled" rule: system assignments with a recycle reason.
  'system_health_recycled', (select count(*) from lead_history, b where assigned_by_type = 'SYSTEM' and recycle_reason is not null and assigned_at >= b.f and assigned_at < b.t)
) j;
