-- 2026-10-29 — Own notifications only for active employees. APPLIED 2026-10-29 17:31 IST (owner's "haan", LF copy of 029ae22); verified active 319 / admin 25130 unchanged, inactive 954 -> 0.
-- Rollback: 2026-10-29_notification_policy_is_active_rollback.sql
--
-- notification_select_own / notification_update_own match the caller through employees.auth_user_id = auth.uid()
-- directly (not through the identity helpers), so an inactive employee with a valid session could still read and mark
-- their notifications (which carry lead names). Both now also require employees.is_active. Admin policies, inserts and
-- service_role writes are unchanged.
begin;
alter policy notification_select_own on public.notification
  using (employee_id in (select employees.id from employees where employees.auth_user_id = (select auth.uid()) and employees.is_active));
alter policy notification_update_own on public.notification
  using (employee_id in (select employees.id from employees where employees.auth_user_id = (select auth.uid()) and employees.is_active));
commit;
