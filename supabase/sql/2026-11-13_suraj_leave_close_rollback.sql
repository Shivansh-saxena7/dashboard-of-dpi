-- ROLLBACK for 2026-11-13_suraj_leave_close.sql: opens Suraj's leave row again (end_date back to NULL).
begin;

do $$
declare n int;
begin
  update public.employee_leave_periods
     set end_date = null
   where id = 'e02f49f2-e912-45a9-9700-aa680c1931cf'
     and start_date = date '2026-08-27'
     and end_date = date '2026-11-13';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'expected 1 closed leave row for Suraj, updated %', n; end if;
end $$;

commit;
