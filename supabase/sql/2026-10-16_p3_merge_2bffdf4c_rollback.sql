-- 2026-10-16 — ROLLBACK for P3: merge of Kashish's duplicate 2bffdf4c into Yogesh's 7ea78721 (..9557).
-- Generated from the backup taken 2026-10-16T13:29:15.364563+00:00 (scratchpad BACKUP_p3_kashish_2bffdf4c_2026-10-16.json).
-- Each block only acts if the removed copy is still merged into the same kept lead.
-- Run BEGIN ... verify ... COMMIT. Kept leads were never changed by the merge, so only the
-- notes / notifications / audit rows the merge added are removed from them.
begin;

-- 2bffdf4c back to its owner (was NEW/LEADS), removed from 7ea78721
do $$ begin if not exists (select 1 from leads where id = '2bffdf4c-cc75-49d1-8ab2-fc702db87f63' and merged_into_lead_id = '7ea78721-fcbf-471c-bfaf-184c040dcff0') then raise notice 'skip 2bffdf4c: not merged into 7ea78721'; return; end if;
  update leads set status = 'NEW', merged_into_lead_id = null, merged_at = null where id = '2bffdf4c-cc75-49d1-8ab2-fc702db87f63';
  update lead_history set is_active = true, ended_reason = null where id = 'ce5942a8-91c3-4598-8d23-75abf955a731';
  delete from lead_notes where lead_id = '7ea78721-fcbf-471c-bfaf-184c040dcff0' and (note like '[Merged duplicate 2bffdf4c]%' or note like '[Merged from duplicate 2bffdf4c]%') and id not in ('1b483879-bf8d-43a0-97b3-deb719eea62e','d97401ba-9ede-47b0-803a-42078449d82e');
  delete from notification where type = 'LEAD_MERGED' and related_lead_id = '7ea78721-fcbf-471c-bfaf-184c040dcff0' and employee_id = 'cf6aac27-c915-417d-b99a-eca9a9d47616' and created_at > '2026-10-16T13:29:15.364563+00:00';
  delete from lead_merge_audit where kept_id8 = '7ea78721' and merged_id8s = array['2bffdf4c'] and merged_at > '2026-10-16T13:29:15.364563+00:00';
end $$;

-- verify: all should be open again, not merged
select left(id::text,8) id8, status, board_stage, merged_into_lead_id from leads where left(id::text,8) in ('2bffdf4c');
-- commit;  (or rollback;)
