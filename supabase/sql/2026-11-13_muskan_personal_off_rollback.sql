-- ROLLBACK for 2026-11-13_muskan_personal_off.sql: the 2 leads become personal leads again.
begin;

do $$
declare n int;
begin
  update public.leads
     set is_personal_lead = true
   where id in ('4490af26-a73d-4604-bf04-5a6765a142ac', '9b609f02-b6e0-42ec-a309-c2d287317fa8')
     and is_personal_lead = false;
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'expected 2 non-personal leads, updated %', n; end if;
end $$;

commit;
