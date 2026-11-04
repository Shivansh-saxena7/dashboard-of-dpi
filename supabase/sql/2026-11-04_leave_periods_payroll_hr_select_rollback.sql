-- Rollback for 2026-11-04_leave_periods_payroll_hr_select.sql.
begin;
drop policy if exists employee_leave_periods_payroll_hr_select on public.employee_leave_periods;
commit;
