-- Rollback for 2026-10-29_identity_is_active.sql: the six helpers exactly as live on 2026-10-29.
begin;
CREATE OR REPLACE FUNCTION public.current_employee_department()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select department from employees where auth_user_id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION public.current_employee_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select id from employees where auth_user_id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION public.current_employee_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select role from employees where auth_user_id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION public.current_employee_team_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select team_id from employees where auth_user_id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from employees
    where auth_user_id = auth.uid() and role in ('admin','super_admin')
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
    where auth_user_id = auth.uid() and role = 'super_admin'
  );
$function$;

commit;
