-- Undo DATA hold merge (8 safe pairs), 2026-11-13: merged leads back as they were (pre_batch_01.json), copied notes off the kept leads, merge notifications and audit rows removed. Kept leads were never changed.
begin;
create temp table _u (d uuid,k uuid,d_status text,d_hist uuid,d_ended text,d_upd timestamptz,d_owner uuid) on commit drop;
insert into _u values
('0bd7ee05-3514-420e-8110-152a80d37830'::uuid,'7c52a548-99f2-40da-9f78-33576ee3f0f3'::uuid,'NEW','e343a5db-1b87-447e-bec0-88faf45ea468'::uuid,null,'2026-10-01T11:33:06.013083+00:00'::timestamptz,'b2c97464-0311-49a1-be0e-94e473c3179f'::uuid),
('13763388-4693-412a-879d-2d18ca7a0c95'::uuid,'0e8b67f1-a353-4412-8f3e-c013b0e37c2e'::uuid,'NOT_CONNECTED','ea3285a0-9a6e-4492-9a50-45930601eb35'::uuid,null,'2026-08-18T08:30:08.134983+00:00'::timestamptz,'1dcbdad8-0a48-450d-a478-bfb36df4ea76'::uuid),
('1729178a-ca34-45c3-8008-4958e3f8e4da'::uuid,'17c2f940-d90b-449d-9961-14bc3b9797ac'::uuid,'NEW','0ae55fcd-7e18-4da5-af55-0fcd353069d9'::uuid,null,'2026-10-01T11:33:09.793298+00:00'::timestamptz,'b2c97464-0311-49a1-be0e-94e473c3179f'::uuid),
('9b3ff396-9497-4446-bf0f-ee68a66a98af'::uuid,'7a2cd4d0-7aff-4fdb-b78e-5c0fdf39fa11'::uuid,'NOT_CONNECTED','eee2ac3e-b0d9-49f2-bed6-257c116b89b7'::uuid,null,'2026-08-31T09:20:21.071368+00:00'::timestamptz,'1dcbdad8-0a48-450d-a478-bfb36df4ea76'::uuid),
('b2eff151-d90f-4c40-9858-c5d281d0b55b'::uuid,'6252ffc8-73cb-45eb-ac44-9f3893a114a9'::uuid,'NOT_CONNECTED','a542c55c-8837-42fb-aa29-105b95e735f9'::uuid,null,'2026-08-25T05:38:51.954329+00:00'::timestamptz,'1dcbdad8-0a48-450d-a478-bfb36df4ea76'::uuid),
('c10160d6-6ded-4c82-ab26-d126ed4cb171'::uuid,'551c9af8-eb7f-47c7-b766-10c31af3ba4d'::uuid,'NEW','3ab91239-8bec-4cc3-aff5-74cb46ad729b'::uuid,null,'2026-10-01T11:33:09.332216+00:00'::timestamptz,'b2c97464-0311-49a1-be0e-94e473c3179f'::uuid),
('db0300c4-621a-4586-a3c6-0cad4ec090ab'::uuid,'2a29f245-0afb-4041-9d5f-ed5f99014bf5'::uuid,'NEW','5f67e31b-6d97-41ab-ac8f-f3b3799b4746'::uuid,null,'2026-10-03T18:00:04.044153+00:00'::timestamptz,'cb7b1333-da1a-4238-ae34-494542f0f446'::uuid),
('ff518c91-ed98-4993-ba0c-549d505d6393'::uuid,'de9e7438-d304-476c-9d91-dbc8df518067'::uuid,'NEW','8e3451d1-a8ec-4e5c-8c52-fbaeb88df17b'::uuid,null,'2026-10-01T11:33:09.006924+00:00'::timestamptz,'b2c97464-0311-49a1-be0e-94e473c3179f'::uuid);
do $$ begin
  if exists (select 1 from _u u left join leads l on l.id=u.d where l.merged_into_lead_id is distinct from u.k) then raise exception 'ABORT: a lead is not merged as expected, stop and check'; end if;
end $$;
delete from lead_notes x using _u u where x.lead_id=u.k and (x.note like '[Merged from duplicate '||left(u.d::text,8)||'] %' or x.note like '[Merged duplicate '||left(u.d::text,8)||'] %');
update lead_history h set is_active=true, ended_reason=u.d_ended from _u u where h.id=u.d_hist;
update leads l set status=u.d_status, merged_into_lead_id=null, merged_at=null from _u u where l.id=u.d;
update notification n set is_read=false, read_at=null where n.id in (null);
delete from notification n using _u u where n.type='LEAD_MERGED' and n.employee_id=u.d_owner and n.related_lead_id=u.k;
delete from lead_merge_audit a using _u u where a.kept_id8=left(u.k::text,8) and a.merged_id8s=array[left(u.d::text,8)];
commit;
