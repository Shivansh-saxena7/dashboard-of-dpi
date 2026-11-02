-- Known-answer tests for 2026-11-02_given_lead_context.sql. Run ONLY inside a transaction that is never committed, after the
-- apply file (without its begin/commit), as postgres. Real leads are used read-only; changes are made in sub-blocks that are undone.
create temp table _t (n int, name text, pass boolean, info text) on commit drop;
create temp table _o on commit drop as
  select left(l.id::text, 8) id8, l.id lead, l.current_owner_id owner, e.auth_user_id auth, h.id hist
  from leads l join employees e on e.id = l.current_owner_id join lead_history h on h.lead_id = l.id and h.is_active
  where left(l.id::text, 8) in ('19e4d6c7', '04b70632', '3e15afd4', '1d2439fb', 'b330a35d');
grant select on _o to authenticated, anon, service_role;
update lead_engine_settings set given_lead_context_mode = 'on' where id = 1;

create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p::text, ''), true),
         set_config('request.jwt.claims', case when p is null then '' else json_build_object('sub', p, 'role', 'authenticated')::text end, true)
$$;
-- the row get_given_lead_context returns for this lead, as this user
create or replace function pg_temp.row_for(p_auth uuid, p_lead uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.as_user(p_auth);
  set local role authenticated;
  select x into v from jsonb_array_elements(get_given_lead_context()->'leads') x where (x->>'lead_id')::uuid = p_lead;
  reset role;
  return v;
end $$;
grant execute on function pg_temp.row_for(uuid, uuid), pg_temp.as_user(uuid) to authenticated;
create or replace function pg_temp.r(p_id8 text) returns jsonb language sql as $$ select pg_temp.row_for(auth, lead) from _o where id8 = p_id8 $$;
-- runs p_change as postgres, reads the row as the owner, undoes everything; returns "absent" or "<in_filter>"
create or replace function pg_temp.after(p_id8 text, p_change text) returns text language plpgsql as $$
declare o record; v jsonb;
begin
  select * into o from _o where id8 = p_id8;
  begin
    execute replace(replace(p_change, '$L', quote_literal(o.lead)), '$H', quote_literal(o.hist));
    v := pg_temp.row_for(o.auth, o.lead);
    raise exception 'PROBE %', coalesce(v->>'in_filter', 'absent');
  exception when others then
    if sqlerrm like 'PROBE %' then return substr(sqlerrm, 7); end if;
    return 'ERROR ' || left(sqlerrm, 90);
  end;
end $$;

insert into _t select 0, 'fixtures: all 5 real leads found', count(*) = 5, count(*)::text from _o;

-- 19e4d6c7: last positive was the owner's own
insert into _t select 1, '19e4d6c7 Connected 10 Oct by you, exact note, nothing after', v#>>'{last_positive,kind}' = 'CONNECTED' and v#>>'{last_positive,is_you}' = 'true' and to_char((v#>>'{last_positive,at}')::timestamptz at time zone 'Asia/Kolkata', 'DD Mon') = '10 Oct'
  and v#>>'{note,text}' = 'Postpone' and v#>>'{note,match}' = 'exact' and v->'after' = 'null'::jsonb and jsonb_array_length(v->'your_notes') = 0, left(v::text, 60) from (select pg_temp.r('19e4d6c7') v) z;
-- 04b70632: someone else's; the caller has no earlier notes
insert into _t select 2, '04b70632 Connected 3 Oct not you, exact note, after Not connected 21 Oct, no own notes', v#>>'{last_positive,kind}' = 'CONNECTED' and v#>>'{last_positive,is_you}' = 'false' and to_char((v#>>'{last_positive,at}')::timestamptz at time zone 'Asia/Kolkata', 'DD Mon') = '03 Oct'
  and v#>>'{note,text}' = 'Not interested' and v#>>'{after,outcome}' = 'NOT_CONNECTED' and to_char((v#>>'{after,at}')::timestamptz at time zone 'Asia/Kolkata', 'DD Mon') = '21 Oct' and jsonb_array_length(v->'your_notes') = 0, null from (select pg_temp.r('04b70632') v) z;
-- 3e15afd4: CONNECTED update whose outcome was overwritten; came back to the same employee, who has an older note
insert into _t select 3, '3e15afd4 Follow-up 13 Oct by you (outcome overwritten), note within 3 min, after Not connected', v#>>'{last_positive,kind}' = 'FOLLOW_UP' and v#>>'{last_positive,is_you}' = 'true' and to_char((v#>>'{last_positive,at}')::timestamptz at time zone 'Asia/Kolkata', 'DD Mon') = '13 Oct'
  and v#>>'{note,match}' = 'exact' and v#>>'{note,text}' like 'Need 2bhk%' and v#>>'{after,outcome}' = 'NOT_CONNECTED', null from (select pg_temp.r('3e15afd4') v) z;
insert into _t select 4, '3e15afd4 your earlier notes: own only, with outcome, without the note already shown', jsonb_array_length(v->'your_notes') = 1 and v#>>'{your_notes,0,note}' = 'Not piked' and v#>>'{your_notes,0,outcome}' = 'NOT_CONNECTED', v->>'your_notes' from (select pg_temp.r('3e15afd4') v) z;
-- 1d2439fb: visit with no note from that employee; the owner's later own note is not used as the visit's note
insert into _t select 5, '1d2439fb Visit 6 Sep not you, no note, after Not interested, own note listed', v#>>'{last_positive,kind}' = 'VISIT' and v#>>'{last_positive,is_you}' = 'false' and to_char((v#>>'{last_positive,at}')::timestamptz at time zone 'Asia/Kolkata', 'DD Mon') = '06 Sep'
  and v->'note' = 'null'::jsonb and v#>>'{after,outcome}' = 'NOT_INTERESTED' and v#>>'{your_notes,0,note}' = 'Ni', null from (select pg_temp.r('1d2439fb') v) z;
-- b330a35d: no notes on the lead at all
insert into _t select 6, 'b330a35d Connected 10 Oct not you, no note, nothing after, no own notes', v#>>'{last_positive,kind}' = 'CONNECTED' and v#>>'{last_positive,is_you}' = 'false' and v->'note' = 'null'::jsonb and v->'after' = 'null'::jsonb and jsonb_array_length(v->'your_notes') = 0, null from (select pg_temp.r('b330a35d') v) z;

-- no names, no ids of other employees anywhere in the keys or values (notes excluded: they are free text)
insert into _t select 7, 'output has only the agreed fields and no employee name or id', bool_and(
    (select array_agg(k order by k) from jsonb_object_keys(v) k) = array['after','given_at','in_filter','last_positive','lead_id','lead_type','note','protected_until','your_notes']
    and (v - 'note' - 'your_notes')::text !~ (select string_agg(regexp_replace(split_part(name, ' ', 1), '\W', '', 'g'), '|') from employees where length(split_part(name, ' ', 1)) > 2)
    and not exists (select 1 from employees e where (v - 'note' - 'your_notes')::text like '%' || e.id::text || '%')), null
  from (select pg_temp.r(id8) v from _o) z;

-- another employee gets nothing about this lead
insert into _t select 8, 'another employee gets nothing for this lead', pg_temp.row_for((select auth_user_id from employees e where e.is_active and e.department = 'sales' and e.id <> o.owner order by e.id limit 1), o.lead) is null, null from _o o where id8 = '04b70632';
-- a person with no employee row, anon, flag off, pilot
create or replace function pg_temp.call_as(p_auth uuid, p_role text) returns text language plpgsql as $$
declare v jsonb; c text;
begin
  perform pg_temp.as_user(p_auth);
  execute 'set local role ' || p_role;
  begin v := get_given_lead_context(); c := (v->>'enabled') || '|' || jsonb_array_length(v->'leads'); exception when others then c := sqlstate; end;
  reset role;
  return c;
end $$;
grant execute on function pg_temp.call_as(uuid, text) to anon, authenticated, service_role;
insert into _t select 9, 'anon: 42501', pg_temp.call_as(null, 'anon') = '42501', pg_temp.call_as(null, 'anon');
insert into _t select 10, 'no employee row: nothing', pg_temp.call_as((select u.id from auth.users u where not exists (select 1 from employees e where e.auth_user_id = u.id) limit 1), 'authenticated') = 'false|0', null;
insert into _t select 11, 'service_role with no user: nothing', pg_temp.call_as(null, 'service_role') = 'false|0', null;
insert into _t select 12, 'grants: PUBLIC/anon closed, helper closed to authenticated, both stable and definer',
  not has_function_privilege('anon', 'get_given_lead_context()', 'execute') and has_function_privilege('authenticated', 'get_given_lead_context()', 'execute') and has_function_privilege('service_role', 'get_given_lead_context()', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'get_given_lead_context()'::regprocedure and a.grantee = 0)
  and not has_function_privilege('authenticated', 'given_lead_context_for(uuid)', 'execute') and not has_function_privilege('anon', 'given_lead_context_for(uuid)', 'execute')
  and (select bool_and(p.provolatile = 's' and p.prosecdef) from pg_proc p where p.proname in ('get_given_lead_context', 'given_lead_context_for', 'given_note_mask') and p.pronamespace = 'public'::regnamespace), null;

-- filter and box lifetime. Each change is undone. b330a35d's owner has not necessarily called it, so it is put in the filter first.
insert into _t select 20, 'untouched assignment is in the filter', pg_temp.after('b330a35d', 'update lead_history set call_count = 0, first_call_at = null, last_activity_at = assigned_at where id = $H') = 'true', null;
insert into _t select 21, 'first call: out of the filter, box stays', pg_temp.after('b330a35d', 'update lead_history set call_count = 1, first_call_at = now(), last_activity_at = now() where id = $H') = 'false', null;
insert into _t select 22, 'result saved: out of the filter, box stays', pg_temp.after('b330a35d', 'update lead_history set call_count = 0, first_call_at = null, outcome = ''CONNECTED'', outcome_at = now(), last_activity_at = assigned_at + interval ''1 hour'' where id = $H') = 'false', null;
insert into _t select 23, 'restore row with outcome_at set and no action: still in the filter', pg_temp.after('b330a35d', 'update lead_history set call_count = 0, first_call_at = null, outcome = ''CONNECTED'', outcome_at = assigned_at, last_activity_at = assigned_at where id = $H') = 'true', null;
insert into _t select 24, 'protection over: no filter, no box', pg_temp.after('b330a35d', 'update lead_restore_log set protected_until = now() - interval ''1 minute'' where lead_id = $L') = 'absent', null;
insert into _t select 25, 'undone: no filter, no box', pg_temp.after('b330a35d', 'update lead_restore_log set undone_at = now() where lead_id = $L') = 'absent', null;
insert into _t select 26, 'recycled away (active assignment closed): no filter, no box', pg_temp.after('b330a35d', 'update lead_history set is_active = false, ended_reason = ''RECYCLE_READY'' where id = $H') = 'absent', null;
insert into _t select 27, 'lead with no restore-log row (force_reassign): no filter, no box', pg_temp.after('b330a35d', 'delete from lead_restore_log where lead_id = $L') = 'absent', null;
create or replace function pg_temp.no_positive() returns text language plpgsql as $$
declare o record; v jsonb;
begin
  select * into o from _o where id8 = 'b330a35d';
  begin
    delete from lead_activity_log where lead_id = o.lead and activity_type in ('STATUS_UPDATE', 'BOARD_STAGE_MOVE');
    v := pg_temp.row_for(o.auth, o.lead);
    raise exception 'PROBE %', coalesce(v->>'last_positive', 'null') || '|' || coalesce(v->>'note', 'null') || '|' || coalesce(v->>'after', 'null');
  exception when others then
    if sqlerrm like 'PROBE %' then return substr(sqlerrm, 7); end if;
    return 'ERROR ' || left(sqlerrm, 90);
  end;
end $$;
insert into _t select 28, 'no positive history: row stays, last positive, note and after all empty', pg_temp.no_positive() = 'null|null|null', pg_temp.no_positive();

-- flag
create or replace function pg_temp.flag(p_mode text, p_in_pilot boolean) returns text language plpgsql as $$
declare o record; v jsonb;
begin
  select * into o from _o where id8 = '04b70632';
  begin
    update lead_engine_settings set given_lead_context_mode = p_mode, given_lead_context_pilot_ids = case when p_in_pilot then array[o.owner] else '{}'::uuid[] end where id = 1;
    perform pg_temp.as_user(o.auth);
    set local role authenticated;
    v := get_given_lead_context();
    reset role;
    raise exception 'PROBE %', v->>'enabled';
  exception when others then
    reset role;
    if sqlerrm like 'PROBE %' then return substr(sqlerrm, 7); end if;
    return 'ERROR ' || left(sqlerrm, 90);
  end;
end $$;
insert into _t select 30, 'flag off: nothing', pg_temp.flag('off', true) = 'false', null;
insert into _t select 31, 'admin_pilot, in the list: on', pg_temp.flag('admin_pilot', true) = 'true', null;
insert into _t select 32, 'admin_pilot, not in the list: nothing', pg_temp.flag('admin_pilot', false) = 'false', null;
insert into _t select 33, 'on: on', pg_temp.flag('on', false) = 'true', null;
insert into _t select 34, 'default is off', (select column_default from information_schema.columns where table_name = 'lead_engine_settings' and column_name = 'given_lead_context_mode') like '%off%', null;

-- names in someone else's note. Uses real employee names read from the table; the clients are made up.
create temp table _nm on commit drop as select
  (select name from employees where name ilike 'Tanu%' limit 1) full_name, split_part((select name from employees where name ilike 'Tanu%' limit 1), ' ', 1) first_name;
insert into _t select 50, 'mask: first name, any case, inside a sentence', given_note_mask('Call back tomorrow ' || lower(first_name) || ' ke phone se') = 'Call back tomorrow a team member ke phone se', given_note_mask('Call back tomorrow ' || lower(first_name) || ' ke phone se') from _nm;
insert into _t select 51, 'mask: full name becomes one phrase', given_note_mask('Owner ' || btrim(full_name) || ', calls 6') = 'Owner a team member, calls 6', given_note_mask('Owner ' || btrim(full_name) || ', calls 6') from _nm;
insert into _t select 52, 'mask: part of a longer word is left alone', given_note_mask(first_name || 'ji needs ' || first_name || 'pur flat') = first_name || 'ji needs ' || first_name || 'pur flat', null from _nm;
insert into _t select 53, 'mask: a surname alone is left alone', given_note_mask('Sharma ji will visit, Singh also') = 'Sharma ji will visit, Singh also', given_note_mask('Sharma ji will visit, Singh also');
insert into _t select 54, 'mask: a note with no name is unchanged', given_note_mask('Need 2bhk ditales shered') = 'Need 2bhk ditales shered', null;
insert into _t select 55, 'mask: closed to employees', not has_function_privilege('authenticated', 'given_note_mask(text)', 'execute') and not has_function_privilege('anon', 'given_note_mask(text)', 'execute'), null;
-- in the box: masked for someone else's note, as written for the caller's own
create or replace function pg_temp.note_probe(p_by_owner boolean) returns text language plpgsql as $$
declare o record; v jsonb; emp uuid; nm text;
begin
  select * into o from _o where id8 = '04b70632';
  select first_name into nm from _nm;
  begin
    if p_by_owner then
      update lead_activity_log set employee_id = o.owner where lead_id = o.lead and activity_type = 'STATUS_UPDATE' and detail = 'CONNECTED';
      update lead_notes set employee_id = o.owner where lead_id = o.lead;
    end if;
    update lead_notes set note = 'Ask ' || nm || ' first' where lead_id = o.lead;
    v := pg_temp.row_for(o.auth, o.lead);
    raise exception 'PROBE %', v#>>'{note,text}';
  exception when others then
    if sqlerrm like 'PROBE %' then return substr(sqlerrm, 7); end if;
    return 'ERROR ' || left(sqlerrm, 90);
  end;
end $$;
insert into _t select 56, 'box: name masked in someone else''s note', pg_temp.note_probe(false) = 'Ask a team member first', pg_temp.note_probe(false);
insert into _t select 57, 'box: the caller''s own note stays as written', pg_temp.note_probe(true) = 'Ask ' || (select first_name from _nm) || ' first', null;

-- a read-only function cannot write: stable + no write statement in either body
insert into _t select 40, 'no write statement in either function', (select bool_and(pg_get_functiondef(p.oid) !~* '\m(insert into|update [a-z_]+ set|delete from)\M') from pg_proc p where p.proname in ('get_given_lead_context', 'given_lead_context_for', 'given_note_mask') and p.pronamespace = 'public'::regnamespace), null;
