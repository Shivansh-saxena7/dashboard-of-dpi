-- 2026-10-16 — ROLLBACK for the single-lead repair of 7ea78721 (..9557, NBCC Aspire Dream Valley):
-- unjunk_and_reassign_lead_atomic gave it back to Yogesh Shukla after the 3rd-recycle auto-JUNK.
-- Values below are from the backup taken before apply (scratchpad BACKUP_p0_7ea78721_2026-10-16.json,
-- taken_at 2026-10-16T12:2x UTC). Run inside BEGIN ... verify ... COMMIT.
begin;
-- remove the assignment + notification the repair created (anything after the backup)
delete from notification
where related_lead_id = (select id from leads where id::text like '7ea78721%')
  and type = 'LEAD_ASSIGNED' and created_at > '2026-10-16 12:00:00+00';
delete from lead_history
where lead_id = (select id from leads where id::text like '7ea78721%')
  and assigned_by_type = 'ADMIN' and assigned_at > '2026-10-16 12:00:00+00';
-- lead back to the junked state it was in
update leads set status = 'JUNK', board_stage = 'LEADS', board_stage_changed_at = null,
  current_owner_id = 'b9f48bb3-88b3-46a3-8029-f648462e7318', recycle_count = 3, last_unjunked_at = null,
  sla_deadline = '2026-10-20 12:45:00+00'
where id::text like '7ea78721%';
-- verify: status JUNK, rc 3, no active assignment, Yogesh's old row (85901f7e) still calls=2
select l.status, l.recycle_count, (select count(*) from lead_history h where h.lead_id = l.id and h.is_active) active_rows,
  (select call_count from lead_history where id::text like '85901f7e%') yogesh_calls
from leads l where l.id::text like '7ea78721%';
-- commit;  (or rollback;)
