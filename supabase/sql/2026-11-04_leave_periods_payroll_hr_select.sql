-- 2026-11-04 - Payroll and HR may read employee_leave_periods, so the LOP compute (it runs in their browser) can treat leave
-- days as neutral. Read only: no insert, update or delete. Admin and each employee's own read are unchanged.
-- Same role check as employees_select_hr. Apply from an LF copy (git show <commit>:<this file>).
-- Rollback: 2026-11-04_leave_periods_payroll_hr_select_rollback.sql
begin;

create policy employee_leave_periods_payroll_hr_select on public.employee_leave_periods
  for select
  to authenticated
  using ((select current_employee_role()) in ('payroll', 'hr'));

commit;
