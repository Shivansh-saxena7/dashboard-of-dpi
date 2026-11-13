-- ROLLBACK for 2026-11-13_system_health_resolve_41.sql: the same 41 rows back to unreviewed.
begin;

do $$
declare n int;
begin
  update public.system_anomaly_log
     set reviewed = false, reviewed_at = null, reviewed_by = null
   where id = any(array['0634cc93-9374-4701-b69d-6dc799a9ab31',
  '0c8a36a3-e755-4131-a61b-0e1812546c4d',
  '0cd5c0f7-b5cb-493c-b239-808f73f7c838',
  '302eadfa-f338-45de-b5ab-8a5cb7bcac58',
  '311e9208-9c0c-4ffe-870a-2670e40a9808',
  '31a55082-8f1c-4075-b567-da763c3fb53e',
  '3ac16e52-458c-4c43-b302-92371d87c1f6',
  '3cc78a6e-272b-449b-b3b9-1ae8af4fb348',
  '4908ae54-1d30-413f-ae40-fd62710e0ead',
  '4ee07f47-a6bd-4bc4-8421-77d52c38ee61',
  '692a098a-6f81-470d-9530-e1c728b21109',
  '6cb575e7-a94c-4e97-afe2-280e09a07677',
  '6d958252-929f-4951-a097-037282eb2acf',
  '75dcf9ef-f704-4e13-b56f-a6a810db25f8',
  '7802a42d-8975-485c-bc2d-af813960a06e',
  '7f00d6ec-89d3-4218-b584-4c6fc7b3620d',
  '8585d44a-2c86-4d2a-ac3e-9312de93b6bf',
  '943904dd-5783-4f26-a90a-19d04caf7149',
  '9464c5c4-9036-4c70-9195-747918afa404',
  '9e3b6c2f-d90a-49d2-b886-1a7c29ab3307',
  '9ff6e4bc-aee7-4a88-b26d-46f72a0d8225',
  'a1044df3-38dd-49b8-8db4-3aa5926051ad',
  'a130f14d-e175-49e5-a7e6-429d9007b88a',
  'a1c0bdb4-c7d4-466c-95a6-8bc614f34b32',
  'a90d2281-6f45-45df-a270-f6b46ee07128',
  'ae349a17-cf6f-4cf4-83c9-99d7d256649d',
  'b02f3a5e-4cf7-4a0c-9c22-1f298ac5d346',
  'b15ba19d-2bb6-4417-bad4-9c6689befad7',
  'bf428a94-a72c-4c2a-b835-81529cc93ae4',
  'c0343728-11e2-4dd1-99de-feb7d31d423c',
  'c47b74bf-f794-4e19-9b4e-844edcb7e3d5',
  'c71b2107-78f7-4a4b-9f12-bc15b08270c7',
  'c9ebee77-0ed4-4e7d-922f-4442be5b4481',
  'd390bc9c-fe47-4177-b87e-96a3a333f2a5',
  'd3ebb558-bec7-4740-a2b2-8b4034ce3f66',
  'd6654de9-838b-4171-8056-e5eddb978f79',
  'e9b73b9f-db39-43b4-892a-d8c5fac2e993',
  'ef3f4af1-628a-4ff0-969d-b81ca2803af8',
  'f2c60a48-4146-43b0-91a3-4309eb96fee1',
  'f6be284e-c49b-4445-b4cc-633e6ddd2a62',
  'fb6b9c5d-7278-4e41-bef9-042271e8a81d']::uuid[])
     and reviewed;
  get diagnostics n = row_count;
  if n <> 41 then raise exception 'expected 41 reviewed rows, updated %', n; end if;
end $$;

commit;
