-- NOT APPLIED. 2026-11-13. Apply only on the owner's "haan", from an LF copy (git show).
-- Suraj (inactive) has had an open-ended leave row since 27 Aug, so the sweep skips all his leads and their timers stand
-- still. This closes that one row on 13 Nov 2026: from 14 Nov his leads run on the normal rules again (leave days stay
-- off their timers). One row, only if it is still open. Rollback: 2026-11-13_suraj_leave_close_rollback.sql.
begin;

do $$
declare n int;
begin
  update public.employee_leave_periods
     set end_date = date '2026-11-13'
   where id = 'e02f49f2-e912-45a9-9700-aa680c1931cf'
     and start_date = date '2026-08-27'
     and end_date is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'expected 1 open leave row for Suraj, updated %', n; end if;
end $$;

commit;
