-- NOT APPLIED. 2026-11-13. Apply only on the owner's "haan", from an LF copy (git show), in one transaction.
-- Takes EXECUTE away from PUBLIC and anon on 8 functions nobody calls without a login: 6 trigger functions (a trigger
-- fires whatever the caller's EXECUTE rights; they are only checked at CREATE TRIGGER), is_lead_terminal (used inside
-- SECURITY DEFINER RPCs and the stuck_leads view) and check_employee_deletion_blockers (used by /api/delete-employee).
-- authenticated and service_role keep their explicit grants. The RLS identity helpers (current_employee_*, is_admin,
-- is_super_admin) are deliberately NOT touched. Rollback: 2026-11-13_anon_revoke_8_functions_rollback.sql.
begin;

revoke execute on function public.check_employee_deletion_blockers(uuid) from public, anon;
revoke execute on function public.create_tracking_rows() from public, anon;
revoke execute on function public.distribution_guard_shadow_log() from public, anon;
revoke execute on function public.enforce_employee_role_department_lock() from public, anon;
revoke execute on function public.is_lead_terminal(text, text) from public, anon;
revoke execute on function public.set_updated_at() from public, anon;
revoke execute on function public.system_anomaly_log_after_insert() from public, anon;
revoke execute on function public.system_anomaly_log_before_insert() from public, anon;

do $$
declare f text; bad text := '';
begin
  foreach f in array array['public.check_employee_deletion_blockers(uuid)','public.create_tracking_rows()','public.distribution_guard_shadow_log()','public.enforce_employee_role_department_lock()','public.is_lead_terminal(text, text)','public.set_updated_at()','public.system_anomaly_log_after_insert()','public.system_anomaly_log_before_insert()'] loop
    if has_function_privilege('anon', f, 'EXECUTE') <> false then bad := bad || ' anon:' || f; end if;
    if not has_function_privilege('authenticated', f, 'EXECUTE') then bad := bad || ' authenticated:' || f; end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then bad := bad || ' service_role:' || f; end if;
    if (select array_agg(x::text order by x::text collate "C") from unnest((select proacl from pg_proc where oid = f::regprocedure)) x) <> array['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[] then bad := bad || ' acl:' || f; end if;
  end loop;
  if bad <> '' then raise exception 'check failed:%', bad; end if;
end $$;

commit;
