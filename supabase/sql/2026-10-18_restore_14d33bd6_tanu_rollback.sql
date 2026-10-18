-- 2026-10-18 — ROLLBACK for the restore of lead 14d33bd6 (..5875, NBCC Aspire Dream Valley) to Tanu Mishra
-- (unjunk_and_reassign_lead_atomic + stage FOLLOW_UP / status CONNECTED). Puts it back to the JUNK state
-- from the backup taken 2026-10-18T11:23:35.856956+00:00 (scratchpad BACKUP_restore_14d33bd6_2026-10-18.json). Run BEGIN ... verify ... COMMIT.
begin;
delete from notification
where related_lead_id = '14d33bd6-6a08-446d-b7bf-205e6e1b8f35' and type = 'LEAD_ASSIGNED' and created_at > '2026-10-18T11:23:35.856956+00:00';
delete from lead_history
where lead_id = '14d33bd6-6a08-446d-b7bf-205e6e1b8f35' and assigned_by_type = 'ADMIN' and assigned_at > '2026-10-18T11:23:35.856956+00:00';
update leads set status = 'JUNK', board_stage = 'LEADS', board_stage_changed_at = null,
  current_owner_id = 'cf6aac27-c915-417d-b99a-eca9a9d47616', recycle_count = 3, last_unjunked_at = null,
  sla_deadline = '2026-10-20T07:30:00+00:00'
where id = '14d33bd6-6a08-446d-b7bf-205e6e1b8f35';
-- verify: JUNK, recycle_count 3, no active assignment, 4 history rows
select status, recycle_count, (select count(*) from lead_history where lead_id = '14d33bd6-6a08-446d-b7bf-205e6e1b8f35' and is_active) active_rows,
  (select count(*) from lead_history where lead_id = '14d33bd6-6a08-446d-b7bf-205e6e1b8f35') history_rows
from leads where id = '14d33bd6-6a08-446d-b7bf-205e6e1b8f35';
-- commit;  (or rollback;)
