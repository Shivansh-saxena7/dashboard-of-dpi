-- ROLLBACK for 2026-11-13_anon_revoke_8_functions.sql: gives PUBLIC and anon EXECUTE back, so every ACL is
-- byte for byte what it was before ({=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}).
begin;

grant execute on function public.check_employee_deletion_blockers(uuid) to public, anon;
grant execute on function public.create_tracking_rows() to public, anon;
grant execute on function public.distribution_guard_shadow_log() to public, anon;
grant execute on function public.enforce_employee_role_department_lock() to public, anon;
grant execute on function public.is_lead_terminal(text, text) to public, anon;
grant execute on function public.set_updated_at() to public, anon;
grant execute on function public.system_anomaly_log_after_insert() to public, anon;
grant execute on function public.system_anomaly_log_before_insert() to public, anon;

do $$
declare f text; bad text := '';
begin
  foreach f in array array['public.check_employee_deletion_blockers(uuid)','public.create_tracking_rows()','public.distribution_guard_shadow_log()','public.enforce_employee_role_department_lock()','public.is_lead_terminal(text, text)','public.set_updated_at()','public.system_anomaly_log_after_insert()','public.system_anomaly_log_before_insert()'] loop
    if has_function_privilege('anon', f, 'EXECUTE') <> true then bad := bad || ' anon:' || f; end if;
    if not has_function_privilege('authenticated', f, 'EXECUTE') then bad := bad || ' authenticated:' || f; end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then bad := bad || ' service_role:' || f; end if;
    if (select proacl::text from pg_proc where oid = f::regprocedure) <> '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}' then bad := bad || ' acl:' || f; end if;
  end loop;
  if bad <> '' then raise exception 'check failed:%', bad; end if;
end $$;

commit;
