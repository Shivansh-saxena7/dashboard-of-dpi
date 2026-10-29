-- Rollback for 2026-10-29_reassign_keep_state.sql. Run the undo file first if any lead was reassigned with it.
-- The ADMIN_REASSIGN activity type stays allowed while any such activity row exists (they are audit history).
begin;
drop function if exists public.reassign_keep_state_atomic(uuid, uuid, text);
do $$ begin
  if not exists (select 1 from lead_activity_log where activity_type = 'ADMIN_REASSIGN') then
    alter table lead_activity_log drop constraint lead_activity_log_activity_type_check;
    alter table lead_activity_log add constraint lead_activity_log_activity_type_check
      check (activity_type = any (array['STATUS_UPDATE'::text, 'BOARD_STAGE_MOVE'::text, 'ADMIN_RESTORE'::text]));
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
