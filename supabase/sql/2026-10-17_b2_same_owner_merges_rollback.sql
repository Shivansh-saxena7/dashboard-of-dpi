-- 2026-10-17 — ROLLBACK for B2: same-owner duplicate groups merged with merge_duplicate_leads.
-- Generated from the backup taken 2026-10-17T07:05:23.209677+00:00 (scratchpad BACKUP_b2_same_owner_2026-10-17.json).
-- Each block only acts if the removed copy is still merged into the same kept lead.
-- Run BEGIN ... verify ... COMMIT. Kept leads were not changed by the merge, so only the
-- copied notes and the audit row are removed from them.
begin;

-- group Yogesh Shukla | Fusion Homes ..0371: keep 77f58bca
do $$ begin if not exists (select 1 from leads where id = '2e85bc17-f103-47d1-80cb-878c44606785' and merged_into_lead_id = '77f58bca-1c94-4519-9252-58ad120078e4') then raise notice 'skip 2e85bc17: not merged into 77f58bca'; return; end if;
  update leads set status = 'NEW', merged_into_lead_id = null, merged_at = null where id = '2e85bc17-f103-47d1-80cb-878c44606785';
  update lead_history set is_active = true, ended_reason = null where id = 'c6e57d4c-7366-4a32-b0c9-a8f127349ec8';
  delete from lead_notes where lead_id = '77f58bca-1c94-4519-9252-58ad120078e4' and note like '[Merged from duplicate 2e85bc17]%' and id not in ('92da3de7-2981-4e91-bcb1-d76d9b7b8b90','d1f3cd76-eae2-436b-9067-d7e4d90e0a31');
end $$;
delete from lead_merge_audit where kept_id8 = '77f58bca' and merged_at > '2026-10-17T07:05:23.209677+00:00' and reason = 'DUPLICATE_MERGED';

-- group Raja Bhardwaj | jewar plot ..5835: keep 8cd149d8
do $$ begin if not exists (select 1 from leads where id = '80ddd463-8da0-4736-9ac6-23a5273cea7e' and merged_into_lead_id = '8cd149d8-c50f-4af5-afc6-9720768ba525') then raise notice 'skip 80ddd463: not merged into 8cd149d8'; return; end if;
  update leads set status = 'NEW', merged_into_lead_id = null, merged_at = null where id = '80ddd463-8da0-4736-9ac6-23a5273cea7e';
  update lead_history set is_active = true, ended_reason = null where id = '404ba2e8-c0bb-4f76-af10-081187a7d221';
  delete from lead_notes where lead_id = '8cd149d8-c50f-4af5-afc6-9720768ba525' and note like '[Merged from duplicate 80ddd463]%';
  update notification set is_read = false, read_at = null where id in ('20805');
end $$;
delete from lead_merge_audit where kept_id8 = '8cd149d8' and merged_at > '2026-10-17T07:05:23.209677+00:00' and reason = 'DUPLICATE_MERGED';

-- group Yogesh Shukla | Nirala Estate Phase 2 ..0369: keep 3f0dec58
do $$ begin if not exists (select 1 from leads where id = '7fc28491-0b7b-45c9-8523-273bc3fbe07e' and merged_into_lead_id = '3f0dec58-e0c3-4d70-8c7a-0e51e57be609') then raise notice 'skip 7fc28491: not merged into 3f0dec58'; return; end if;
  update leads set status = 'NEW', merged_into_lead_id = null, merged_at = null where id = '7fc28491-0b7b-45c9-8523-273bc3fbe07e';
  update lead_history set is_active = true, ended_reason = null where id = '7aa1b63c-b859-4835-ad60-8cee29e50779';
  delete from lead_notes where lead_id = '3f0dec58-e0c3-4d70-8c7a-0e51e57be609' and note like '[Merged from duplicate 7fc28491]%' and id not in ('3ebe22bd-af4b-4305-90d3-c67975963b4b','82313684-535c-41b6-9ea5-60becb265898','03d4edea-6e5f-4a26-8f96-4b823f71dc72');
end $$;
delete from lead_merge_audit where kept_id8 = '3f0dec58' and merged_at > '2026-10-17T07:05:23.209677+00:00' and reason = 'DUPLICATE_MERGED';

-- group Tanu Mishra  | CRC Sublimis ..2202: keep c5b7b70c
do $$ begin if not exists (select 1 from leads where id = '4792f385-1da2-49d1-aa9f-0c7ff6ce33af' and merged_into_lead_id = 'c5b7b70c-0145-4384-9be8-477ee39bc0e5') then raise notice 'skip 4792f385: not merged into c5b7b70c'; return; end if;
  update leads set status = 'NOT_CONNECTED', merged_into_lead_id = null, merged_at = null where id = '4792f385-1da2-49d1-aa9f-0c7ff6ce33af';
  update lead_history set is_active = true, ended_reason = null where id = '61724d20-5bdf-4c1c-9e91-a690785de9af';
  delete from lead_notes where lead_id = 'c5b7b70c-0145-4384-9be8-477ee39bc0e5' and note like '[Merged from duplicate 4792f385]%' and id not in ('2526c272-dad4-4a46-ae6c-2e031f4f3f8c','61cd2218-ae56-4bb7-acee-6e47ff2dfd5a');
end $$;
delete from lead_merge_audit where kept_id8 = 'c5b7b70c' and merged_at > '2026-10-17T07:05:23.209677+00:00' and reason = 'DUPLICATE_MERGED';

-- group Yogesh Shukla | La Residentia ..7280: keep 57d81190
do $$ begin if not exists (select 1 from leads where id = '53df8153-2c89-4f67-ad8b-609788065202' and merged_into_lead_id = '57d81190-be10-4ea6-a357-5e70d64a971a') then raise notice 'skip 53df8153: not merged into 57d81190'; return; end if;
  update leads set status = 'NEW', merged_into_lead_id = null, merged_at = null where id = '53df8153-2c89-4f67-ad8b-609788065202';
  update lead_history set is_active = true, ended_reason = null where id = '8d1a8bdb-461b-408d-899d-59e1b855e869';
  delete from lead_notes where lead_id = '57d81190-be10-4ea6-a357-5e70d64a971a' and note like '[Merged from duplicate 53df8153]%' and id not in ('c6523ac3-3405-406c-9c25-830e491a66da','e52fad69-174e-4b43-ad16-46bcaca35578');
  update notification set is_read = false, read_at = null where id in ('16661');
end $$;
delete from lead_merge_audit where kept_id8 = '57d81190' and merged_at > '2026-10-17T07:05:23.209677+00:00' and reason = 'DUPLICATE_MERGED';

-- group Muskan Purohit | Apex Splendour ..5319: keep 79e0574a
do $$ begin if not exists (select 1 from leads where id = 'e2bb0c37-019f-4222-b293-b9efb16deb28' and merged_into_lead_id = '79e0574a-2956-4b5e-b7bf-e2b1fac78828') then raise notice 'skip e2bb0c37: not merged into 79e0574a'; return; end if;
  update leads set status = 'NOT_CONNECTED', merged_into_lead_id = null, merged_at = null where id = 'e2bb0c37-019f-4222-b293-b9efb16deb28';
  update lead_history set is_active = true, ended_reason = null where id = '07b6a706-4a24-4891-ae48-3fc04ac1f016';
  delete from lead_notes where lead_id = '79e0574a-2956-4b5e-b7bf-e2b1fac78828' and note like '[Merged from duplicate e2bb0c37]%' and id not in ('73d8aa89-2494-406a-8d29-bf39e861f29a','3c68d64c-20db-49e6-89f5-8f0415f0a89a');
  update notification set is_read = false, read_at = null where id in ('21433');
end $$;
do $$ begin if not exists (select 1 from leads where id = 'ea3a6bf8-88e4-4069-aa3d-29190be00d76' and merged_into_lead_id = '79e0574a-2956-4b5e-b7bf-e2b1fac78828') then raise notice 'skip ea3a6bf8: not merged into 79e0574a'; return; end if;
  update leads set status = 'NEW', merged_into_lead_id = null, merged_at = null where id = 'ea3a6bf8-88e4-4069-aa3d-29190be00d76';
  update lead_history set is_active = true, ended_reason = null where id = '112b0b2a-0eaa-4e3e-8c76-f978305fc25b';
  delete from lead_notes where lead_id = '79e0574a-2956-4b5e-b7bf-e2b1fac78828' and note like '[Merged from duplicate ea3a6bf8]%' and id not in ('73d8aa89-2494-406a-8d29-bf39e861f29a','3c68d64c-20db-49e6-89f5-8f0415f0a89a');
end $$;
delete from lead_merge_audit where kept_id8 = '79e0574a' and merged_at > '2026-10-17T07:05:23.209677+00:00' and reason = 'DUPLICATE_MERGED';

-- group Yogesh Shukla | Arihant Abode ..3639: keep 6d546465
do $$ begin if not exists (select 1 from leads where id = '6b8981f6-25a7-42b0-bcb0-f50ba1ec7e17' and merged_into_lead_id = '6d546465-993d-46ce-98eb-053a230df491') then raise notice 'skip 6b8981f6: not merged into 6d546465'; return; end if;
  update leads set status = 'CONNECTED', merged_into_lead_id = null, merged_at = null where id = '6b8981f6-25a7-42b0-bcb0-f50ba1ec7e17';
  update lead_history set is_active = true, ended_reason = null where id = '3e966ac1-67cc-46f1-a094-4d8f92992876';
  delete from lead_notes where lead_id = '6d546465-993d-46ce-98eb-053a230df491' and note like '[Merged from duplicate 6b8981f6]%' and id not in ('a17cdfde-7224-4da4-b912-7dadb9a3dff1','479dc850-9cd8-460e-ab62-59142ba6c5dc','ad263dee-43ba-4cb6-b329-9214f3e6ceb2','bd1c6cf4-9b93-481a-b558-0d15530a28f5');
end $$;
delete from lead_merge_audit where kept_id8 = '6d546465' and merged_at > '2026-10-17T07:05:23.209677+00:00' and reason = 'DUPLICATE_MERGED';

-- group Raja Bhardwaj | Fusion Homes ..8459: keep 22e167b8
do $$ begin if not exists (select 1 from leads where id = '04cc5c99-800e-471d-be85-07caaf238579' and merged_into_lead_id = '22e167b8-0651-48bb-99fb-d5e064094f9d') then raise notice 'skip 04cc5c99: not merged into 22e167b8'; return; end if;
  update leads set status = 'NEW', merged_into_lead_id = null, merged_at = null where id = '04cc5c99-800e-471d-be85-07caaf238579';
  update lead_history set is_active = true, ended_reason = null where id = '8159ff21-778f-47f5-870c-2a01e76ecfc9';
  delete from lead_notes where lead_id = '22e167b8-0651-48bb-99fb-d5e064094f9d' and note like '[Merged from duplicate 04cc5c99]%' and id not in ('078e7cd6-8240-47bd-a1b6-27744e69108b');
  update notification set is_read = false, read_at = null where id in ('20896');
end $$;
delete from lead_merge_audit where kept_id8 = '22e167b8' and merged_at > '2026-10-17T07:05:23.209677+00:00' and reason = 'DUPLICATE_MERGED';

-- group Tanu Mishra  | NBCC Aspire Dream Valley ..0371: keep d37ab68c
do $$ begin if not exists (select 1 from leads where id = 'b7906e1c-82ba-445a-88ea-7b8a1e7dbeae' and merged_into_lead_id = 'd37ab68c-811e-46cb-90e1-22c03ce04d95') then raise notice 'skip b7906e1c: not merged into d37ab68c'; return; end if;
  update leads set status = 'NOT_CONNECTED', merged_into_lead_id = null, merged_at = null where id = 'b7906e1c-82ba-445a-88ea-7b8a1e7dbeae';
  update lead_history set is_active = true, ended_reason = null where id = 'c4d05095-8083-40ab-876b-02418fa448cf';
  delete from lead_notes where lead_id = 'd37ab68c-811e-46cb-90e1-22c03ce04d95' and note like '[Merged from duplicate b7906e1c]%' and id not in ('9564a102-9640-46a3-8504-59d53d110a47','6c35c687-7972-4902-9bbe-28ff37a4b4d3');
end $$;
delete from lead_merge_audit where kept_id8 = 'd37ab68c' and merged_at > '2026-10-17T07:05:23.209677+00:00' and reason = 'DUPLICATE_MERGED';

-- group Muskan Purohit | Civitech Strings ..3555: keep 96f0b351
do $$ begin if not exists (select 1 from leads where id = 'e0126fb1-1ac1-4eee-9c24-a4a020b6e8d3' and merged_into_lead_id = '96f0b351-1c0c-4f94-843e-742c4043d0b0') then raise notice 'skip e0126fb1: not merged into 96f0b351'; return; end if;
  update leads set status = 'NOT_CONNECTED', merged_into_lead_id = null, merged_at = null where id = 'e0126fb1-1ac1-4eee-9c24-a4a020b6e8d3';
  update lead_history set is_active = true, ended_reason = null where id = '56fd2345-2426-4184-b654-0bd52cd35ebd';
  delete from lead_notes where lead_id = '96f0b351-1c0c-4f94-843e-742c4043d0b0' and note like '[Merged from duplicate e0126fb1]%' and id not in ('00304bed-f110-411c-b563-d7ee47dab143','4b36860c-b8c3-4799-bb4d-2dcdc52dd416');
end $$;
delete from lead_merge_audit where kept_id8 = '96f0b351' and merged_at > '2026-10-17T07:05:23.209677+00:00' and reason = 'DUPLICATE_MERGED';

-- group Muskan Purohit | CRC Sublimis ..2076: keep ca9d6e03
do $$ begin if not exists (select 1 from leads where id = '349711ea-92c9-499a-8356-29fa00304e16' and merged_into_lead_id = 'ca9d6e03-e153-4774-92ff-763a6b4287d7') then raise notice 'skip 349711ea: not merged into ca9d6e03'; return; end if;
  update leads set status = 'NEW', merged_into_lead_id = null, merged_at = null where id = '349711ea-92c9-499a-8356-29fa00304e16';
  update lead_history set is_active = true, ended_reason = null where id = 'c3e805ab-e0eb-4048-8051-4dbd5df491f2';
  delete from lead_notes where lead_id = 'ca9d6e03-e153-4774-92ff-763a6b4287d7' and note like '[Merged from duplicate 349711ea]%' and id not in ('c0b194e4-f44a-44cf-ab35-7c150b8c928f','72001104-07f1-44eb-b63c-666217fd801b','9da40608-7835-4eed-a995-6e0d4486444c','0b49de07-b097-409d-91ef-0fd19ceec27e');
  update notification set is_read = false, read_at = null where id in ('21082');
end $$;
delete from lead_merge_audit where kept_id8 = 'ca9d6e03' and merged_at > '2026-10-17T07:05:23.209677+00:00' and reason = 'DUPLICATE_MERGED';

-- group Tanu Mishra  | NBCC Aspire Dream Valley ..2718: keep 243b2457
do $$ begin if not exists (select 1 from leads where id = '3e6f547e-c300-4290-81b0-db6c879c14a0' and merged_into_lead_id = '243b2457-ac7f-4d1b-8ea1-ac6c474511f0') then raise notice 'skip 3e6f547e: not merged into 243b2457'; return; end if;
  update leads set status = 'NOT_CONNECTED', merged_into_lead_id = null, merged_at = null where id = '3e6f547e-c300-4290-81b0-db6c879c14a0';
  update lead_history set is_active = true, ended_reason = null where id = 'ff7f14de-9a28-44ad-a541-fb1276d9301c';
  delete from lead_notes where lead_id = '243b2457-ac7f-4d1b-8ea1-ac6c474511f0' and note like '[Merged from duplicate 3e6f547e]%' and id not in ('072dc766-3f09-4b2d-9c68-7312325f331a','985298b2-5a30-464c-ba9c-958a9b832cc8','fdff118d-1eec-45a4-9a8a-c2ee3a398bea');
end $$;
delete from lead_merge_audit where kept_id8 = '243b2457' and merged_at > '2026-10-17T07:05:23.209677+00:00' and reason = 'DUPLICATE_MERGED';

-- group Yogesh Shukla | Patel Neotown ..6166: keep 8db87969
do $$ begin if not exists (select 1 from leads where id = '4c244bf0-78c8-460f-b155-f2e8024eb145' and merged_into_lead_id = '8db87969-f1de-4d09-aa38-25c16f91f97d') then raise notice 'skip 4c244bf0: not merged into 8db87969'; return; end if;
  update leads set status = 'NEW', merged_into_lead_id = null, merged_at = null where id = '4c244bf0-78c8-460f-b155-f2e8024eb145';
  update lead_history set is_active = true, ended_reason = null where id = '355fe899-90e2-4070-a5ba-e08fc6172a96';
  delete from lead_notes where lead_id = '8db87969-f1de-4d09-aa38-25c16f91f97d' and note like '[Merged from duplicate 4c244bf0]%' and id not in ('befd6f59-5cca-49e5-b7d8-4037d05ad6c6','48a9f85a-306e-4ad6-b2d6-fcb6d70507ef','cf9ff854-9aa5-4120-be92-9a8c8e475c29');
end $$;
delete from lead_merge_audit where kept_id8 = '8db87969' and merged_at > '2026-10-17T07:05:23.209677+00:00' and reason = 'DUPLICATE_MERGED';

-- group Muskan Purohit | NBCC Aspire Dream Valley ..1209: keep 7638e944
do $$ begin if not exists (select 1 from leads where id = '632c0295-57ac-4b51-861e-4fcc9385c6cb' and merged_into_lead_id = '7638e944-bd7c-44c3-b21e-55f17692e4b2') then raise notice 'skip 632c0295: not merged into 7638e944'; return; end if;
  update leads set status = 'CONNECTED', merged_into_lead_id = null, merged_at = null where id = '632c0295-57ac-4b51-861e-4fcc9385c6cb';
  update lead_history set is_active = true, ended_reason = null where id = 'd09d600a-cfc9-49cf-97d3-e5e9f82f0e0c';
  delete from lead_notes where lead_id = '7638e944-bd7c-44c3-b21e-55f17692e4b2' and note like '[Merged from duplicate 632c0295]%' and id not in ('62eb7977-c7f0-48f5-a96f-77dd47201d05','cbe71c5c-5083-40ee-af49-eee2e9d3e89f','a231335d-17c7-466e-b21a-b74b45ea6139');
end $$;
do $$ begin if not exists (select 1 from leads where id = '314577a5-9d45-41ff-bb1c-f53b1037604e' and merged_into_lead_id = '7638e944-bd7c-44c3-b21e-55f17692e4b2') then raise notice 'skip 314577a5: not merged into 7638e944'; return; end if;
  update leads set status = 'NOT_INTERESTED', merged_into_lead_id = null, merged_at = null where id = '314577a5-9d45-41ff-bb1c-f53b1037604e';
  update lead_history set is_active = true, ended_reason = null where id = 'eb1537c4-d235-4a14-a5eb-5e3d49ab1f5d';
  delete from lead_notes where lead_id = '7638e944-bd7c-44c3-b21e-55f17692e4b2' and note like '[Merged from duplicate 314577a5]%' and id not in ('62eb7977-c7f0-48f5-a96f-77dd47201d05','cbe71c5c-5083-40ee-af49-eee2e9d3e89f','a231335d-17c7-466e-b21a-b74b45ea6139');
end $$;
delete from lead_merge_audit where kept_id8 = '7638e944' and merged_at > '2026-10-17T07:05:23.209677+00:00' and reason = 'DUPLICATE_MERGED';

-- group Yogesh Shukla | CRC Sublimis ..2202: keep 36b75dd9
do $$ begin if not exists (select 1 from leads where id = '6f53e938-ce52-4055-8879-6a0a50109d0e' and merged_into_lead_id = '36b75dd9-77bc-4001-b4dc-04cc8d9ed258') then raise notice 'skip 6f53e938: not merged into 36b75dd9'; return; end if;
  update leads set status = 'NOT_INTERESTED', merged_into_lead_id = null, merged_at = null where id = '6f53e938-ce52-4055-8879-6a0a50109d0e';
  update lead_history set is_active = true, ended_reason = null where id = '82236eaa-ef48-4c35-9b6f-0f8433c9dc30';
  delete from lead_notes where lead_id = '36b75dd9-77bc-4001-b4dc-04cc8d9ed258' and note like '[Merged from duplicate 6f53e938]%' and id not in ('51ec9a17-bd52-4bb5-941c-fe864963d462','9783b235-6379-4f14-8873-f27cad08235d','2737f608-fc0d-4799-85fb-bf07302f2359');
end $$;
delete from lead_merge_audit where kept_id8 = '36b75dd9' and merged_at > '2026-10-17T07:05:23.209677+00:00' and reason = 'DUPLICATE_MERGED';

-- group Tanu Mishra  | Arihant Abode ..2452: keep 2c773bf4
do $$ begin if not exists (select 1 from leads where id = 'cfe316aa-395c-4375-9f9e-e0f2bdfe7e7f' and merged_into_lead_id = '2c773bf4-b353-4bbf-896d-68d4fee73081') then raise notice 'skip cfe316aa: not merged into 2c773bf4'; return; end if;
  update leads set status = 'NOT_CONNECTED', merged_into_lead_id = null, merged_at = null where id = 'cfe316aa-395c-4375-9f9e-e0f2bdfe7e7f';
  update lead_history set is_active = true, ended_reason = null where id = '4b33571c-ceae-4bb0-bd01-1df9a4a92315';
  delete from lead_notes where lead_id = '2c773bf4-b353-4bbf-896d-68d4fee73081' and note like '[Merged from duplicate cfe316aa]%' and id not in ('ed7786b9-5523-47e1-afb6-b05f2f132298','7a8ba974-928f-450f-8bd0-c63a0c41997e');
end $$;
do $$ begin if not exists (select 1 from leads where id = 'fbe18fb8-d2d8-43dc-be75-4e58adc1e800' and merged_into_lead_id = '2c773bf4-b353-4bbf-896d-68d4fee73081') then raise notice 'skip fbe18fb8: not merged into 2c773bf4'; return; end if;
  update leads set status = 'NOT_CONNECTED', merged_into_lead_id = null, merged_at = null where id = 'fbe18fb8-d2d8-43dc-be75-4e58adc1e800';
  update lead_history set is_active = true, ended_reason = null where id = '51065b63-9da8-46f7-afc0-6c7c775bb96f';
  delete from lead_notes where lead_id = '2c773bf4-b353-4bbf-896d-68d4fee73081' and note like '[Merged from duplicate fbe18fb8]%' and id not in ('ed7786b9-5523-47e1-afb6-b05f2f132298','7a8ba974-928f-450f-8bd0-c63a0c41997e');
end $$;
delete from lead_merge_audit where kept_id8 = '2c773bf4' and merged_at > '2026-10-17T07:05:23.209677+00:00' and reason = 'DUPLICATE_MERGED';

-- group Yogesh Shukla | CRC Sublimis ..0522: keep aa2bdae4
do $$ begin if not exists (select 1 from leads where id = '33a2c101-173a-4a0c-9bd1-6fe9a449ef80' and merged_into_lead_id = 'aa2bdae4-58af-4239-9c5a-547178d33419') then raise notice 'skip 33a2c101: not merged into aa2bdae4'; return; end if;
  update leads set status = 'NOT_INTERESTED', merged_into_lead_id = null, merged_at = null where id = '33a2c101-173a-4a0c-9bd1-6fe9a449ef80';
  update lead_history set is_active = true, ended_reason = null where id = '60bcd99a-1c87-485d-a8e1-22a1a6d64b6f';
  delete from lead_notes where lead_id = 'aa2bdae4-58af-4239-9c5a-547178d33419' and note like '[Merged from duplicate 33a2c101]%' and id not in ('cdf559c9-541d-4ab1-86b8-da50bb760c6f','9c571745-e840-4266-bb60-224aa3aa28de','9f4ffa78-19d1-4b2c-a042-05e0d1a547d0');
end $$;
delete from lead_merge_audit where kept_id8 = 'aa2bdae4' and merged_at > '2026-10-17T07:05:23.209677+00:00' and reason = 'DUPLICATE_MERGED';

-- group Raja Bhardwaj | Nirala Greenshire ..1320: keep f8b78afd
do $$ begin if not exists (select 1 from leads where id = '9b47e1ee-6301-4db4-88c9-ea62f9052316' and merged_into_lead_id = 'f8b78afd-5aac-4362-86e3-6cbb465843de') then raise notice 'skip 9b47e1ee: not merged into f8b78afd'; return; end if;
  update leads set status = 'NEW', merged_into_lead_id = null, merged_at = null where id = '9b47e1ee-6301-4db4-88c9-ea62f9052316';
  update lead_history set is_active = true, ended_reason = null where id = '4580e4ea-d9a7-4d8b-8a05-ff9df5a1331b';
  delete from lead_notes where lead_id = 'f8b78afd-5aac-4362-86e3-6cbb465843de' and note like '[Merged from duplicate 9b47e1ee]%' and id not in ('595316fd-141a-45b8-97f9-e2e22d31c9c8','e90850cc-abc0-4651-8c05-9a392ec1253c');
  update notification set is_read = false, read_at = null where id in ('21642');
end $$;
delete from lead_merge_audit where kept_id8 = 'f8b78afd' and merged_at > '2026-10-17T07:05:23.209677+00:00' and reason = 'DUPLICATE_MERGED';

-- group Yogesh Shukla | NBCC Aspire Dream Valley ..3342: keep c651da57
do $$ begin if not exists (select 1 from leads where id = 'c3da1201-4b8a-4f48-95c8-8ad435f0bf66' and merged_into_lead_id = 'c651da57-b3a9-4a40-a3be-014a6b8109a6') then raise notice 'skip c3da1201: not merged into c651da57'; return; end if;
  update leads set status = 'NOT_CONNECTED', merged_into_lead_id = null, merged_at = null where id = 'c3da1201-4b8a-4f48-95c8-8ad435f0bf66';
  update lead_history set is_active = true, ended_reason = null where id = 'aabcdcfe-7ff2-4f42-99ad-38c134d8c9b5';
  delete from lead_notes where lead_id = 'c651da57-b3a9-4a40-a3be-014a6b8109a6' and note like '[Merged from duplicate c3da1201]%' and id not in ('1dfb198d-1c19-4057-8de9-cfcf640e1242');
end $$;
do $$ begin if not exists (select 1 from leads where id = '99264e00-c8a1-4633-b491-0d87860b4ac5' and merged_into_lead_id = 'c651da57-b3a9-4a40-a3be-014a6b8109a6') then raise notice 'skip 99264e00: not merged into c651da57'; return; end if;
  update leads set status = 'CONNECTED', merged_into_lead_id = null, merged_at = null where id = '99264e00-c8a1-4633-b491-0d87860b4ac5';
  update lead_history set is_active = true, ended_reason = null where id = '30e74ad4-31ef-4751-80d0-78dd72f0a173';
  delete from lead_notes where lead_id = 'c651da57-b3a9-4a40-a3be-014a6b8109a6' and note like '[Merged from duplicate 99264e00]%' and id not in ('1dfb198d-1c19-4057-8de9-cfcf640e1242');
end $$;
delete from lead_merge_audit where kept_id8 = 'c651da57' and merged_at > '2026-10-17T07:05:23.209677+00:00' and reason = 'DUPLICATE_MERGED';

-- group Raja Bhardwaj | Supercity Mayfair Residency ..1761: keep 262a22e5
do $$ begin if not exists (select 1 from leads where id = '6469f5e4-0676-4c62-89ca-7de817acaff8' and merged_into_lead_id = '262a22e5-79a5-469b-9310-ca8f64a9fc2c') then raise notice 'skip 6469f5e4: not merged into 262a22e5'; return; end if;
  update leads set status = 'NOT_CONNECTED', merged_into_lead_id = null, merged_at = null where id = '6469f5e4-0676-4c62-89ca-7de817acaff8';
  update lead_history set is_active = true, ended_reason = null where id = 'c9238329-79d4-44bd-8ee3-d7e09862dad6';
  delete from lead_notes where lead_id = '262a22e5-79a5-469b-9310-ca8f64a9fc2c' and note like '[Merged from duplicate 6469f5e4]%' and id not in ('0ddd4646-8e22-4e38-802b-549beddfea27');
end $$;
delete from lead_merge_audit where kept_id8 = '262a22e5' and merged_at > '2026-10-17T07:05:23.209677+00:00' and reason = 'DUPLICATE_MERGED';

-- group Raja Bhardwaj | Arihant Abode ..9735: keep be4d6e75
do $$ begin if not exists (select 1 from leads where id = '5530d2eb-c960-4b2e-aef3-c37566bca5d7' and merged_into_lead_id = 'be4d6e75-a385-464a-8f6b-8706db0eb9cf') then raise notice 'skip 5530d2eb: not merged into be4d6e75'; return; end if;
  update leads set status = 'NEW', merged_into_lead_id = null, merged_at = null where id = '5530d2eb-c960-4b2e-aef3-c37566bca5d7';
  update lead_history set is_active = true, ended_reason = null where id = '1b29e74b-12b2-445d-973e-c30314c7b38f';
  delete from lead_notes where lead_id = 'be4d6e75-a385-464a-8f6b-8706db0eb9cf' and note like '[Merged from duplicate 5530d2eb]%' and id not in ('edc5aea6-5061-417a-8dc8-dd4172fed83e','e2067946-b3d1-41fd-affd-7f87ff3a5c3f');
  update notification set is_read = false, read_at = null where id in ('21330');
end $$;
delete from lead_merge_audit where kept_id8 = 'be4d6e75' and merged_at > '2026-10-17T07:05:23.209677+00:00' and reason = 'DUPLICATE_MERGED';

-- group Tanu Mishra  | Nirala Estate Phase 2 ..4215: keep 62555995
do $$ begin if not exists (select 1 from leads where id = '1e010fe6-ef95-40ca-abd8-84059598401d' and merged_into_lead_id = '62555995-a4f5-44a4-bda7-bd0ec6572a49') then raise notice 'skip 1e010fe6: not merged into 62555995'; return; end if;
  update leads set status = 'NEW', merged_into_lead_id = null, merged_at = null where id = '1e010fe6-ef95-40ca-abd8-84059598401d';
  update lead_history set is_active = true, ended_reason = null where id = 'f199441a-6235-444e-94ca-32dab3afc286';
  delete from lead_notes where lead_id = '62555995-a4f5-44a4-bda7-bd0ec6572a49' and note like '[Merged from duplicate 1e010fe6]%' and id not in ('70112894-8334-4e20-a96e-1220f654308a','7b59a265-dd90-469e-8715-d0c0936cb4d2','b0ea8386-89d0-4e6d-822a-094210c166dc','9097e74f-d088-455e-a772-baa05cc2c907');
end $$;
delete from lead_merge_audit where kept_id8 = '62555995' and merged_at > '2026-10-17T07:05:23.209677+00:00' and reason = 'DUPLICATE_MERGED';

-- group Tanu Mishra  | NBCC Aspire Dream Valley ..9372: keep a498d81b
do $$ begin if not exists (select 1 from leads where id = 'b18b37b1-1935-4480-b08e-d63ae430cf94' and merged_into_lead_id = 'a498d81b-7aa0-4673-b99e-e170eb850e18') then raise notice 'skip b18b37b1: not merged into a498d81b'; return; end if;
  update leads set status = 'NOT_CONNECTED', merged_into_lead_id = null, merged_at = null where id = 'b18b37b1-1935-4480-b08e-d63ae430cf94';
  update lead_history set is_active = true, ended_reason = null where id = 'bd2eca58-ca9e-4247-ad65-a91743721fa5';
  delete from lead_notes where lead_id = 'a498d81b-7aa0-4673-b99e-e170eb850e18' and note like '[Merged from duplicate b18b37b1]%' and id not in ('d98a72a4-4e2a-4096-85fc-5dd44f81e05d','445e642d-15c6-47aa-a036-9b4511caf405','7ea210a3-8c6e-417c-ac7a-f010f144b7ef','38c00014-66a2-4164-84fd-95585f75a306');
end $$;
delete from lead_merge_audit where kept_id8 = 'a498d81b' and merged_at > '2026-10-17T07:05:23.209677+00:00' and reason = 'DUPLICATE_MERGED';

-- group Tanu Mishra  | La Residentia ..7280: keep b5aab7da
do $$ begin if not exists (select 1 from leads where id = '854c4fd5-75bf-412a-a727-505bef281628' and merged_into_lead_id = 'b5aab7da-dabe-4e77-80df-0420942f2000') then raise notice 'skip 854c4fd5: not merged into b5aab7da'; return; end if;
  update leads set status = 'NEW', merged_into_lead_id = null, merged_at = null where id = '854c4fd5-75bf-412a-a727-505bef281628';
  update lead_history set is_active = true, ended_reason = null where id = 'b188ce01-41b2-48f6-bad5-709b47d8ed74';
  delete from lead_notes where lead_id = 'b5aab7da-dabe-4e77-80df-0420942f2000' and note like '[Merged from duplicate 854c4fd5]%';
end $$;
delete from lead_merge_audit where kept_id8 = 'b5aab7da' and merged_at > '2026-10-17T07:05:23.209677+00:00' and reason = 'DUPLICATE_MERGED';

-- group Muskan Purohit | La Residentia ..4853: keep 28af3859
do $$ begin if not exists (select 1 from leads where id = '1d87809f-4145-4644-90db-bda175bd8e1c' and merged_into_lead_id = '28af3859-51d2-44fb-871d-e73887eda05e') then raise notice 'skip 1d87809f: not merged into 28af3859'; return; end if;
  update leads set status = 'NOT_CONNECTED', merged_into_lead_id = null, merged_at = null where id = '1d87809f-4145-4644-90db-bda175bd8e1c';
  update lead_history set is_active = true, ended_reason = null where id = '0085d661-9886-4411-a02a-ead02065ef5d';
  delete from lead_notes where lead_id = '28af3859-51d2-44fb-871d-e73887eda05e' and note like '[Merged from duplicate 1d87809f]%' and id not in ('fd297716-77bc-452b-be05-3f909fbdc413');
end $$;
delete from lead_merge_audit where kept_id8 = '28af3859' and merged_at > '2026-10-17T07:05:23.209677+00:00' and reason = 'DUPLICATE_MERGED';

-- group Tanu Mishra  | NBCC Aspire Dream Valley ..3090: keep e09d2864
do $$ begin if not exists (select 1 from leads where id = '5b5e2354-c0b8-41d3-b2c0-87bdb85d9058' and merged_into_lead_id = 'e09d2864-bf22-4d61-9caa-ce997b385abb') then raise notice 'skip 5b5e2354: not merged into e09d2864'; return; end if;
  update leads set status = 'NOT_CONNECTED', merged_into_lead_id = null, merged_at = null where id = '5b5e2354-c0b8-41d3-b2c0-87bdb85d9058';
  update lead_history set is_active = true, ended_reason = null where id = 'eb55b465-b67f-403c-b295-c8f765b16b84';
  delete from lead_notes where lead_id = 'e09d2864-bf22-4d61-9caa-ce997b385abb' and note like '[Merged from duplicate 5b5e2354]%' and id not in ('bde7891f-eeba-438f-b44d-9c08b8a4dd2c','16604df4-5e2d-4545-a0e2-764a227f9b40','03bc1235-eb16-41b7-b1f1-d2f4e78603e8');
  update notification set is_read = false, read_at = null where id in ('21673');
end $$;
delete from lead_merge_audit where kept_id8 = 'e09d2864' and merged_at > '2026-10-17T07:05:23.209677+00:00' and reason = 'DUPLICATE_MERGED';

-- verify: every removed copy open again
select count(*) filter (where merged_into_lead_id is null and status <> 'JUNK') reopened, count(*) total from leads where id in ('2e85bc17-f103-47d1-80cb-878c44606785','80ddd463-8da0-4736-9ac6-23a5273cea7e','7fc28491-0b7b-45c9-8523-273bc3fbe07e','4792f385-1da2-49d1-aa9f-0c7ff6ce33af','53df8153-2c89-4f67-ad8b-609788065202','e2bb0c37-019f-4222-b293-b9efb16deb28','ea3a6bf8-88e4-4069-aa3d-29190be00d76','6b8981f6-25a7-42b0-bcb0-f50ba1ec7e17','04cc5c99-800e-471d-be85-07caaf238579','b7906e1c-82ba-445a-88ea-7b8a1e7dbeae','e0126fb1-1ac1-4eee-9c24-a4a020b6e8d3','349711ea-92c9-499a-8356-29fa00304e16','3e6f547e-c300-4290-81b0-db6c879c14a0','4c244bf0-78c8-460f-b155-f2e8024eb145','632c0295-57ac-4b51-861e-4fcc9385c6cb','314577a5-9d45-41ff-bb1c-f53b1037604e','6f53e938-ce52-4055-8879-6a0a50109d0e','cfe316aa-395c-4375-9f9e-e0f2bdfe7e7f','fbe18fb8-d2d8-43dc-be75-4e58adc1e800','33a2c101-173a-4a0c-9bd1-6fe9a449ef80','9b47e1ee-6301-4db4-88c9-ea62f9052316','c3da1201-4b8a-4f48-95c8-8ad435f0bf66','99264e00-c8a1-4633-b491-0d87860b4ac5','6469f5e4-0676-4c62-89ca-7de817acaff8','5530d2eb-c960-4b2e-aef3-c37566bca5d7','1e010fe6-ef95-40ca-abd8-84059598401d','b18b37b1-1935-4480-b08e-d63ae430cf94','854c4fd5-75bf-412a-a727-505bef281628','1d87809f-4145-4644-90db-bda175bd8e1c','5b5e2354-c0b8-41d3-b2c0-87bdb85d9058');
-- commit;  (or rollback;)
