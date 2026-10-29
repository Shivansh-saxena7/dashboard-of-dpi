-- Rollback for 2026-10-29_security_phase1_revoke.sql: restores the same grants as on 2026-10-29
-- (PUBLIC, postgres, anon, authenticated, service_role all EXECUTE; the acl entries come back in a different order, same set).
begin;
grant execute on function public.assign_lead_atomic(uuid, uuid, uuid, uuid, text, uuid) to public, anon, authenticated, service_role;
grant execute on function public.recycle_lead_atomic(uuid, uuid, uuid, uuid, uuid, text) to public, anon, authenticated, service_role;
grant execute on function public.send_birthday_celebration_atomic(uuid) to public, anon, authenticated, service_role;
notify pgrst, 'reload schema';
commit;
