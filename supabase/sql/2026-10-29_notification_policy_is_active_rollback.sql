-- Rollback for 2026-10-29_notification_policy_is_active.sql: both policies exactly as on 2026-10-29
-- (backup: C:/work/reports/notification_policies_2026-10-29.json).
begin;
alter policy notification_select_own on public.notification
  using (employee_id in (select employees.id from employees where employees.auth_user_id = (select auth.uid())));
alter policy notification_update_own on public.notification
  using (employee_id in (select employees.id from employees where employees.auth_user_id = (select auth.uid())));
commit;
