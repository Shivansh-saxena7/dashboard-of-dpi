-- 2026-10-16 — ROLLBACK for B1 cross-owner merges (2026-10-16_b1_cross_owner_merges_apply.sql).
-- Generated from the backup taken 2026-10-16T13:27:36.930316+00:00 (scratchpad BACKUP_b1_cross_owner_2026-10-16_v2.json).
-- Each block only acts if the removed copy is still merged into the same kept lead.
-- Run BEGIN ... verify ... COMMIT. Kept leads were never changed by the merge, so only the
-- notes / notifications / audit rows the merge added are removed from them.
begin;

-- a8da5628 back to its owner (was NOT_CONNECTED/LEADS), removed from bdb9a3f2
do $$ begin if not exists (select 1 from leads where id = 'a8da5628-bbc6-448d-af2b-d3b754e2ed99' and merged_into_lead_id = 'bdb9a3f2-06f5-46f2-957b-d467f4c00647') then raise notice 'skip a8da5628: not merged into bdb9a3f2'; return; end if;
  update leads set status = 'NOT_CONNECTED', merged_into_lead_id = null, merged_at = null where id = 'a8da5628-bbc6-448d-af2b-d3b754e2ed99';
  update lead_history set is_active = true, ended_reason = null where id = 'f427a1f2-0a26-456b-b92c-4c1e98ee0c88';
  delete from lead_notes where lead_id = 'bdb9a3f2-06f5-46f2-957b-d467f4c00647' and (note like '[Merged duplicate a8da5628]%' or note like '[Merged from duplicate a8da5628]%') and id not in ('19d94ae4-06c2-41a4-bf88-3f0d087031aa');
  delete from notification where type = 'LEAD_MERGED' and related_lead_id = 'bdb9a3f2-06f5-46f2-957b-d467f4c00647' and employee_id = 'fb014d6e-0be6-474a-b023-dcb5d673f2a9' and created_at > '2026-10-16T13:27:36.930316+00:00';
  delete from lead_merge_audit where kept_id8 = 'bdb9a3f2' and merged_id8s = array['a8da5628'] and merged_at > '2026-10-16T13:27:36.930316+00:00';
end $$;

-- 51a61592 back to its owner (was NOT_CONNECTED/LEADS), removed from bdb9a3f2
do $$ begin if not exists (select 1 from leads where id = '51a61592-b083-42c1-b15a-44dae2b2727b' and merged_into_lead_id = 'bdb9a3f2-06f5-46f2-957b-d467f4c00647') then raise notice 'skip 51a61592: not merged into bdb9a3f2'; return; end if;
  update leads set status = 'NOT_CONNECTED', merged_into_lead_id = null, merged_at = null where id = '51a61592-b083-42c1-b15a-44dae2b2727b';
  update lead_history set is_active = true, ended_reason = null where id = '85b9d0fc-bc99-47dc-b602-7674e26ef70f';
  delete from lead_notes where lead_id = 'bdb9a3f2-06f5-46f2-957b-d467f4c00647' and (note like '[Merged duplicate 51a61592]%' or note like '[Merged from duplicate 51a61592]%') and id not in ('19d94ae4-06c2-41a4-bf88-3f0d087031aa');
  delete from notification where type = 'LEAD_MERGED' and related_lead_id = 'bdb9a3f2-06f5-46f2-957b-d467f4c00647' and employee_id = 'fb014d6e-0be6-474a-b023-dcb5d673f2a9' and created_at > '2026-10-16T13:27:36.930316+00:00';
  delete from lead_merge_audit where kept_id8 = 'bdb9a3f2' and merged_id8s = array['51a61592'] and merged_at > '2026-10-16T13:27:36.930316+00:00';
end $$;

-- f9582f1c back to its owner (was NOT_CONNECTED/FOLLOW_UP), removed from d3139b5c
do $$ begin if not exists (select 1 from leads where id = 'f9582f1c-f736-4fdb-a785-8823ebd85ce2' and merged_into_lead_id = 'd3139b5c-7c6a-461e-a5e7-242e38262939') then raise notice 'skip f9582f1c: not merged into d3139b5c'; return; end if;
  update leads set status = 'NOT_CONNECTED', merged_into_lead_id = null, merged_at = null where id = 'f9582f1c-f736-4fdb-a785-8823ebd85ce2';
  update lead_history set is_active = true, ended_reason = null where id = '26b9cfcd-d43d-4554-824f-9727ed0a894c';
  delete from lead_notes where lead_id = 'd3139b5c-7c6a-461e-a5e7-242e38262939' and (note like '[Merged duplicate f9582f1c]%' or note like '[Merged from duplicate f9582f1c]%') and id not in ('f43d7118-0ddd-4f38-a5f2-775f1c86c02b','abde3290-8f2d-4100-8153-b8072a097c6c','7760ea39-e15b-4b27-8324-62aefd6c6f45');
  delete from notification where type = 'LEAD_MERGED' and related_lead_id = 'd3139b5c-7c6a-461e-a5e7-242e38262939' and employee_id = 'b9f48bb3-88b3-46a3-8029-f648462e7318' and created_at > '2026-10-16T13:27:36.930316+00:00';
  delete from lead_merge_audit where kept_id8 = 'd3139b5c' and merged_id8s = array['f9582f1c'] and merged_at > '2026-10-16T13:27:36.930316+00:00';
end $$;

-- 3244ee5e back to its owner (was NOT_CONNECTED/LEADS), removed from 4ccd453e
do $$ begin if not exists (select 1 from leads where id = '3244ee5e-3479-4d95-9097-f05bc67299ad' and merged_into_lead_id = '4ccd453e-9c09-4b95-8206-bbd8a553c45f') then raise notice 'skip 3244ee5e: not merged into 4ccd453e'; return; end if;
  update leads set status = 'NOT_CONNECTED', merged_into_lead_id = null, merged_at = null where id = '3244ee5e-3479-4d95-9097-f05bc67299ad';
  update lead_history set is_active = true, ended_reason = null where id = 'b30c96b5-f604-4438-96d7-49c2c7028167';
  delete from lead_notes where lead_id = '4ccd453e-9c09-4b95-8206-bbd8a553c45f' and (note like '[Merged duplicate 3244ee5e]%' or note like '[Merged from duplicate 3244ee5e]%') and id not in ('8a7383d8-9ef2-4115-96e6-e544a05bfac2');
  delete from notification where type = 'LEAD_MERGED' and related_lead_id = '4ccd453e-9c09-4b95-8206-bbd8a553c45f' and employee_id = 'b2c97464-0311-49a1-be0e-94e473c3179f' and created_at > '2026-10-16T13:27:36.930316+00:00';
  delete from lead_merge_audit where kept_id8 = '4ccd453e' and merged_id8s = array['3244ee5e'] and merged_at > '2026-10-16T13:27:36.930316+00:00';
end $$;

-- 9e1e4a3a back to its owner (was NOT_CONNECTED/LEADS), removed from 7479ee6e
do $$ begin if not exists (select 1 from leads where id = '9e1e4a3a-ff8c-4b3a-8350-4754af1c28dc' and merged_into_lead_id = '7479ee6e-d517-4fbe-aaf5-1f08230c93bf') then raise notice 'skip 9e1e4a3a: not merged into 7479ee6e'; return; end if;
  update leads set status = 'NOT_CONNECTED', merged_into_lead_id = null, merged_at = null where id = '9e1e4a3a-ff8c-4b3a-8350-4754af1c28dc';
  update lead_history set is_active = true, ended_reason = null where id = 'ba2aa642-eb70-45cf-877a-39cbd0acf1eb';
  delete from lead_notes where lead_id = '7479ee6e-d517-4fbe-aaf5-1f08230c93bf' and (note like '[Merged duplicate 9e1e4a3a]%' or note like '[Merged from duplicate 9e1e4a3a]%');
  delete from notification where type = 'LEAD_MERGED' and related_lead_id = '7479ee6e-d517-4fbe-aaf5-1f08230c93bf' and employee_id = '27c38b3a-a104-42a0-8d8a-2033c03059ae' and created_at > '2026-10-16T13:27:36.930316+00:00';
  delete from lead_merge_audit where kept_id8 = '7479ee6e' and merged_id8s = array['9e1e4a3a'] and merged_at > '2026-10-16T13:27:36.930316+00:00';
end $$;

-- 56a9556d back to its owner (was NEW/LEADS), removed from 45e6e5fb
do $$ begin if not exists (select 1 from leads where id = '56a9556d-4f1f-43ee-8a58-11beeeb56fb6' and merged_into_lead_id = '45e6e5fb-2d7c-45b3-9b01-f5c44fbb0241') then raise notice 'skip 56a9556d: not merged into 45e6e5fb'; return; end if;
  update leads set status = 'NEW', merged_into_lead_id = null, merged_at = null where id = '56a9556d-4f1f-43ee-8a58-11beeeb56fb6';
  update lead_history set is_active = true, ended_reason = null where id = '26a754c5-c9e7-4cea-b95b-eee9df5d2a17';
  delete from lead_notes where lead_id = '45e6e5fb-2d7c-45b3-9b01-f5c44fbb0241' and (note like '[Merged duplicate 56a9556d]%' or note like '[Merged from duplicate 56a9556d]%') and id not in ('baed0f2b-15cc-45a6-b933-ac843e5c7607','429daf8d-bd1a-469f-8506-0fbc11861fda','15342b8d-1089-45a1-930c-fc44db38ba68','d5e43aab-f64e-4d8b-99d3-51eb89241beb','d9aa5532-f472-4810-81b9-6a79ed8384ed');
  delete from notification where type = 'LEAD_MERGED' and related_lead_id = '45e6e5fb-2d7c-45b3-9b01-f5c44fbb0241' and employee_id = 'fb014d6e-0be6-474a-b023-dcb5d673f2a9' and created_at > '2026-10-16T13:27:36.930316+00:00';
  delete from lead_merge_audit where kept_id8 = '45e6e5fb' and merged_id8s = array['56a9556d'] and merged_at > '2026-10-16T13:27:36.930316+00:00';
end $$;

-- 6773d58e back to its owner (was NOT_CONNECTED/LEADS), removed from a1a080c6
do $$ begin if not exists (select 1 from leads where id = '6773d58e-b9ff-4d49-bf59-41c98c837df9' and merged_into_lead_id = 'a1a080c6-61bb-491a-b9cd-7669e8261009') then raise notice 'skip 6773d58e: not merged into a1a080c6'; return; end if;
  update leads set status = 'NOT_CONNECTED', merged_into_lead_id = null, merged_at = null where id = '6773d58e-b9ff-4d49-bf59-41c98c837df9';
  update lead_history set is_active = true, ended_reason = null where id = '63762da7-cf8d-4ee8-b887-77144e88d957';
  delete from lead_notes where lead_id = 'a1a080c6-61bb-491a-b9cd-7669e8261009' and (note like '[Merged duplicate 6773d58e]%' or note like '[Merged from duplicate 6773d58e]%') and id not in ('937765d3-a2a5-4354-afce-07acabbc58be','04deb2e1-2cf8-4dae-bfc7-4ac8e4ed788e','72b13979-c516-44b0-aa9f-2b7676cdbeab','2e63a65a-3f2c-4b17-bed0-be5239caa7b0','72141259-f4cb-4cb9-ba64-95fcbd792115');
  delete from notification where type = 'LEAD_MERGED' and related_lead_id = 'a1a080c6-61bb-491a-b9cd-7669e8261009' and employee_id = '7ae5a64f-6375-4e15-8653-19116e8853e3' and created_at > '2026-10-16T13:27:36.930316+00:00';
  delete from lead_merge_audit where kept_id8 = 'a1a080c6' and merged_id8s = array['6773d58e'] and merged_at > '2026-10-16T13:27:36.930316+00:00';
end $$;

-- verify: all should be open again, not merged
select left(id::text,8) id8, status, board_stage, merged_into_lead_id from leads where left(id::text,8) in ('a8da5628','51a61592','f9582f1c','3244ee5e','9e1e4a3a','56a9556d','6773d58e');
-- commit;  (or rollback;)

-- Function removal (only if it should go too):
-- drop function if exists public.merge_cross_owner_duplicate(uuid, uuid, text, text);
