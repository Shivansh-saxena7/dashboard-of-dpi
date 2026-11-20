-- DATA SQL, ALREADY APPLIED (the other 4 of the 8 hold-pair merges, 2026-11-13/14), DO NOT RE-RUN. Recorded 2026-11-20 from the 2026-11-13 prep branch; SQL unchanged.
-- DATA hold merge, 8 safe pairs, 2026-11-13. NOT APPLIED: only on the owner's haan, between sweeps. All or nothing. Pre-state: pre_batch_B.json, undo: undo_batch_B.sql
begin;
create temp table _p (d uuid,k uuid,k_owner uuid,k_status text,k_stage text,k_rc int,k_upd timestamptz,k_hist uuid,k_last timestamptz,k_calls int,k_notes int,k_hists int,d_owner uuid,d_notes int,d_hists int,d_status text) on commit drop;
insert into _p values
('13763388-4693-412a-879d-2d18ca7a0c95'::uuid,'0e8b67f1-a353-4412-8f3e-c013b0e37c2e'::uuid,'27c38b3a-a104-42a0-8d8a-2033c03059ae'::uuid,'NEW','LEADS',0,'2026-10-03T09:55:28.123704+00:00'::timestamptz,'83afdb85-ca71-4123-b6fe-1d9754ac51fd'::uuid,'2026-10-03T09:55:28.123704+00:00'::timestamptz,0,0,1,'1dcbdad8-0a48-450d-a478-bfb36df4ea76'::uuid,1,1,'NOT_CONNECTED'),
('9b3ff396-9497-4446-bf0f-ee68a66a98af'::uuid,'7a2cd4d0-7aff-4fdb-b78e-5c0fdf39fa11'::uuid,'8546dc4d-1f5f-49e8-bdbe-8c364c7f5272'::uuid,'NEW','LEADS',0,'2026-11-03T06:16:03.9667+00:00'::timestamptz,'2daa18b7-b619-4a26-825e-0b57fcd9d9cd'::uuid,'2026-11-03T06:16:03.9667+00:00'::timestamptz,0,0,1,'1dcbdad8-0a48-450d-a478-bfb36df4ea76'::uuid,1,1,'NOT_CONNECTED'),
('b2eff151-d90f-4c40-9858-c5d281d0b55b'::uuid,'6252ffc8-73cb-45eb-ac44-9f3893a114a9'::uuid,'27c38b3a-a104-42a0-8d8a-2033c03059ae'::uuid,'NEW','LEADS',0,'2026-10-03T09:55:30.131345+00:00'::timestamptz,'8b7380a8-795a-42bc-b0de-c8b4971111c0'::uuid,'2026-10-03T09:55:30.131345+00:00'::timestamptz,0,0,1,'1dcbdad8-0a48-450d-a478-bfb36df4ea76'::uuid,1,1,'NOT_CONNECTED'),
('db0300c4-621a-4586-a3c6-0cad4ec090ab'::uuid,'2a29f245-0afb-4041-9d5f-ed5f99014bf5'::uuid,'16f3aeb4-cd2d-4841-b90b-eb47abf6cca9'::uuid,'NOT_INTERESTED','LEADS',0,'2026-11-05T10:40:09.790095+00:00'::timestamptz,'bea24567-fd5d-4207-8ac5-f7e5b5d4e5af'::uuid,'2026-11-05T10:40:09.790095+00:00'::timestamptz,1,0,1,'cb7b1333-da1a-4238-ae34-494542f0f446'::uuid,2,3,'NEW');
select set_config('request.jwt.claim.sub', (select auth_user_id from employees where role='admin' and is_active order by created_at limit 1)::text, true), set_config('request.jwt.claims', json_build_object('sub',(select auth_user_id from employees where role='admin' and is_active order by created_at limit 1),'role','authenticated')::text, true);
-- The merged-away (inactive owner's) lead has no project; give it the kept lead's project so the merge function
-- accepts the pair. Only NULL projects, exactly 4 rows. The kept lead is not changed. Undo sets them back to NULL.
do $$ declare n int; begin
  update leads d set project = k.project from _p p join leads k on k.id = p.k where d.id = p.d and d.project is null and btrim(coalesce(k.project, '')) <> '';
  get diagnostics n = row_count;
  if n <> 4 then raise exception 'ABORT: expected 4 empty projects to fill, filled %', n; end if;
end $$;
do $$ declare r record; begin
  for r in select * from _p loop
    if not exists (select 1 from leads a join leads b on b.id=r.k where a.id=r.d and a.mobile_normalized=b.mobile_normalized and lower(btrim(coalesce(a.name,'')))=lower(btrim(coalesce(b.name,''))) and (lower(btrim(coalesce(a.project,'')))=lower(btrim(coalesce(b.project,''))) or btrim(coalesce(a.project,''))='' or btrim(coalesce(b.project,''))='') and a.status=r.d_status and a.merged_into_lead_id is null and b.merged_into_lead_id is null and a.current_owner_id=r.d_owner and b.current_owner_id=r.k_owner and b.status=r.k_status) then
      raise exception 'ABORT: pair % changed since the backup', left(r.d::text,8);
    end if;
    perform merge_cross_owner_duplicate(r.k, r.d, 'LEAD', 'DATA hold, 8 safe pairs, 2026-11-13: same number and name as the active employee''s lead; same project or one side blank');
  end loop;
end $$;
commit;
