-- DATA hold merge, 8 safe pairs, 2026-11-13. NOT APPLIED: only on the owner's haan, between sweeps. All or nothing. Pre-state: pre_batch_A.json, undo: undo_batch_A.sql
begin;
create temp table _p (d uuid,k uuid,k_owner uuid,k_status text,k_stage text,k_rc int,k_upd timestamptz,k_hist uuid,k_last timestamptz,k_calls int,k_notes int,k_hists int,d_owner uuid,d_notes int,d_hists int,d_status text) on commit drop;
insert into _p values
('0bd7ee05-3514-420e-8110-152a80d37830'::uuid,'7c52a548-99f2-40da-9f78-33576ee3f0f3'::uuid,'1477ab14-302d-4255-9b5b-2e8871029b11'::uuid,'NEW','LEADS',0,'2026-10-15T07:37:56.98975+00:00'::timestamptz,'1b58a859-2763-4459-a400-5b271895b934'::uuid,'2026-10-15T07:37:56.98975+00:00'::timestamptz,0,0,1,'b2c97464-0311-49a1-be0e-94e473c3179f'::uuid,0,1,'NEW'),
('1729178a-ca34-45c3-8008-4958e3f8e4da'::uuid,'17c2f940-d90b-449d-9961-14bc3b9797ac'::uuid,'1477ab14-302d-4255-9b5b-2e8871029b11'::uuid,'NEW','LEADS',0,'2026-10-15T07:38:00.872769+00:00'::timestamptz,'bc11f52e-9e2c-4c99-bbe0-cc5084fc6607'::uuid,'2026-10-15T07:38:00.872769+00:00'::timestamptz,0,0,1,'b2c97464-0311-49a1-be0e-94e473c3179f'::uuid,0,1,'NEW'),
('c10160d6-6ded-4c82-ab26-d126ed4cb171'::uuid,'551c9af8-eb7f-47c7-b766-10c31af3ba4d'::uuid,'1477ab14-302d-4255-9b5b-2e8871029b11'::uuid,'NEW','LEADS',0,'2026-10-15T07:38:00.265552+00:00'::timestamptz,'49e4caac-5580-4828-bb54-9d3b4987ea39'::uuid,'2026-10-15T07:38:00.265552+00:00'::timestamptz,0,0,1,'b2c97464-0311-49a1-be0e-94e473c3179f'::uuid,0,1,'NEW'),
('ff518c91-ed98-4993-ba0c-549d505d6393'::uuid,'de9e7438-d304-476c-9d91-dbc8df518067'::uuid,'1477ab14-302d-4255-9b5b-2e8871029b11'::uuid,'NEW','LEADS',0,'2026-10-15T07:37:59.877304+00:00'::timestamptz,'0f47b7be-8ad8-452d-bd4e-0b95ddca4e65'::uuid,'2026-10-15T07:37:59.877304+00:00'::timestamptz,0,0,1,'b2c97464-0311-49a1-be0e-94e473c3179f'::uuid,0,1,'NEW');
select set_config('request.jwt.claim.sub', (select auth_user_id from employees where role='admin' and is_active order by created_at limit 1)::text, true), set_config('request.jwt.claims', json_build_object('sub',(select auth_user_id from employees where role='admin' and is_active order by created_at limit 1),'role','authenticated')::text, true);
do $$ declare r record; begin
  for r in select * from _p loop
    if not exists (select 1 from leads a join leads b on b.id=r.k where a.id=r.d and a.mobile_normalized=b.mobile_normalized and lower(btrim(coalesce(a.name,'')))=lower(btrim(coalesce(b.name,''))) and (lower(btrim(coalesce(a.project,'')))=lower(btrim(coalesce(b.project,''))) or btrim(coalesce(a.project,''))='' or btrim(coalesce(b.project,''))='') and a.status=r.d_status and a.merged_into_lead_id is null and b.merged_into_lead_id is null and a.current_owner_id=r.d_owner and b.current_owner_id=r.k_owner and b.status=r.k_status) then
      raise exception 'ABORT: pair % changed since the backup', left(r.d::text,8);
    end if;
    perform merge_cross_owner_duplicate(r.k, r.d, 'LEAD', 'DATA hold, 8 safe pairs, 2026-11-13: same number and name as the active employee''s lead; same project or one side blank');
  end loop;
end $$;
commit;
