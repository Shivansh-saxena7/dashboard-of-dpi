-- 2026-11-15. Additive: three indexes on foreign-key columns that point at leads and had none, so every lead delete
-- (CSV batch delete, delete blocker counts) scanned the whole table. Apply BEFORE 2026-11-15_delete_blocker.sql,
-- from an LF copy, between sweeps. Rollback: 2026-11-15_fk_indexes_rollback.sql.
begin;

create index if not exists notification_related_lead_id_idx on public.notification (related_lead_id);
create index if not exists lead_notes_lead_id_idx on public.lead_notes (lead_id);
create index if not exists leads_merged_into_lead_id_idx on public.leads (merged_into_lead_id);

do $$
begin
  if (select count(*) from pg_indexes where schemaname = 'public'
      and indexname in ('notification_related_lead_id_idx', 'lead_notes_lead_id_idx', 'leads_merged_into_lead_id_idx')) <> 3 then
    raise exception 'indexes missing';
  end if;
end $$;

commit;
