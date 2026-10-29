-- 2026-10-29 — Identity helpers ignore inactive employees. APPLIED 2026-10-29 17:01 IST (owner's "haan", LF copy of 137a641); verified: active/admin/orphan unchanged, inactive users lose access.
-- Rollback: 2026-10-29_identity_is_active_rollback.sql (byte-exact copy outside git: C:/work/reports/identity_rollback_exact.sql)
--
-- Until now an inactive employee with a still-valid session kept full RLS and RPC access (no helper and none of the 205
-- policies looked at employees.is_active; only the login page / SessionGuard signed them out). After this, all six
-- helpers treat an inactive employee like "no employee": id/role/team/department null, is_admin/is_super_admin false.
-- Safe only together with the NULL-safe role checks (2026-10-29_security_nullcheck_fix.sql, applied 16:37), which make
-- every role check refuse a NULL role. employees_select_own uses auth.uid() directly, so the app can still read the
-- own row and sign the user out. service_role / cron / edge functions have no auth.uid() and are not affected.
begin;
CREATE OR REPLACE FUNCTION public.current_employee_department()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select department from employees where auth_user_id = auth.uid() and is_active
$function$;

CREATE OR REPLACE FUNCTION public.current_employee_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select id from employees where auth_user_id = auth.uid() and is_active
$function$;

CREATE OR REPLACE FUNCTION public.current_employee_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select role from employees where auth_user_id = auth.uid() and is_active
$function$;

CREATE OR REPLACE FUNCTION public.current_employee_team_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select team_id from employees where auth_user_id = auth.uid() and is_active
$function$;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from employees
    where auth_user_id = auth.uid() and is_active and role in ('admin','super_admin')
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from employees
    where auth_user_id = auth.uid() and is_active and role = 'super_admin'
  );
$function$;

commit;
