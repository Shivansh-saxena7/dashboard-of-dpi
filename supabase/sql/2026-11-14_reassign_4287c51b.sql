-- DATA SQL, ALREADY APPLIED (lead 4287c51b keep-state reassign, 2026-11-14), DO NOT RE-RUN. Recorded 2026-11-20 from the 2026-11-13 prep branch; SQL unchanged.
-- NOT APPLIED. 2026-11-14. Apply only on the owner's "haan", from an LF copy (git show), between sweeps.
-- Lead 4287c51b (LEAD, NOT_INTERESTED / LEADS, rc 3, positive history: Connected 16 Oct) Tanu -> Rashmi, keep state:
-- reassign_keep_state_atomic keeps status, stage and history and gives restore_protection_days of protection.
-- Tanu is on leave until 15 Nov; her protection ended 14 Nov 11:23; with two Not Interested results it would be
-- auto-junked at the first sweep after her leave. All or nothing; aborts if the lead changed or was not reassigned.
-- Rollback: 2026-11-14_reassign_4287c51b_rollback.sql
begin;

select set_config('request.jwt.claim.sub', (select auth_user_id from employees where role = 'admin' and is_active order by created_at limit 1)::text, true),
       set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from employees where role = 'admin' and is_active order by created_at limit 1), 'role', 'authenticated')::text, true);

do $$
declare r jsonb;
begin
  if not exists (select 1 from leads where id = '4287c51b-dc78-443e-b318-a089b1b20115' and current_owner_id = '27c38b3a-a104-42a0-8d8a-2033c03059ae' and status = 'NOT_INTERESTED'
                 and coalesce(board_stage, 'LEADS') = 'LEADS' and merged_into_lead_id is null) then
    raise exception 'ABORT: lead 4287c51b is no longer Tanu''s NOT_INTERESTED / LEADS lead';
  end if;
  r := reassign_keep_state_atomic('4287c51b-dc78-443e-b318-a089b1b20115'::uuid, '16f3aeb4-cd2d-4841-b90b-eb47abf6cca9'::uuid,
    'Owner on leave until 15 Nov; positive history (Connected 16 Oct); kept as it is with Rashmi, owner''s decision 14 Nov');
  if r->>'result' is distinct from 'REASSIGNED' or (select current_owner_id from leads where id = '4287c51b-dc78-443e-b318-a089b1b20115') <> '16f3aeb4-cd2d-4841-b90b-eb47abf6cca9' then
    raise exception 'ABORT: not reassigned: %', r;
  end if;
end $$;

commit;
