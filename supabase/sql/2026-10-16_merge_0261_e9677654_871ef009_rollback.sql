-- RECORD ONLY. Not applied. Undoes the 2026-10-16 merge of duplicate lead 871ef009... into e9677654...
-- (number ending 0261), done with merge_duplicate_leads. The kept lead e9677654 was not changed by the
-- merge, so nothing is restored on it except removing the two copied notes.
-- Full pre-merge backup (client data) is kept outside the repo.
begin;

-- 1) the merged copy back to how it was (CONNECTED / FOLLOW_UP, not merged)
update leads
set status = 'CONNECTED', merged_into_lead_id = null, merged_at = null
where id::text like '871ef009%' and merged_into_lead_id::text like 'e9677654%';

-- 2) its assignment active again (Yogesh, history dfbe9610)
update lead_history
set is_active = true, ended_reason = null
where id = 'dfbe9610-c6d3-4453-9cc4-57f5474edcbf' and ended_reason = 'JUNK';

-- 3) remove the two notes the merge copied onto the kept lead
delete from lead_notes
where lead_id::text like 'e9677654%' and note like '[Merged from duplicate 871ef009] %';

-- 4) remove the audit row of this merge
delete from lead_merge_audit
where kept_id8 = 'e9677654' and '871ef009' = any(merged_id8s);

-- (no notifications to restore: the merged copy had no unread notifications)
select left(id::text, 8) as lead, status, board_stage, merged_into_lead_id from leads where id::text like '871ef009%' or id::text like 'e9677654%';
commit;
