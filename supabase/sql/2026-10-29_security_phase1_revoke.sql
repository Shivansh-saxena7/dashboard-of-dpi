-- 2026-10-29 — Security Phase 1. NOT APPLIED — apply only after the owner's "haan".
-- Rollback: 2026-10-29_security_phase1_revoke_rollback.sql
--
-- Three SECURITY DEFINER functions that write data without checking who is calling were executable by
-- PUBLIC / anon / authenticated, i.e. by anyone holding the public anon key. Their only direct callers are
-- edge functions, all through createMonitoredClient() = service_role:
--   assign_lead_atomic               assign-lead, _shared/distributeLeads.ts (import-leads-csv, retry-lead-distribution)
--   recycle_lead_atomic              recycle-stale-leads
--   send_birthday_celebration_atomic send-birthday-celebrations
-- Indirect callers inside the DB (make_legacy_lead, create_personal_lead_atomic, create_manual_lead_atomic,
-- create_manual_booking_lead_atomic) are SECURITY DEFINER owned by postgres, so their inner call runs as the
-- owner and is not affected. No cron job, trigger or view calls these three.
begin;
revoke all on function public.assign_lead_atomic(uuid, uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.recycle_lead_atomic(uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.send_birthday_celebration_atomic(uuid) from public, anon, authenticated;
grant execute on function public.assign_lead_atomic(uuid, uuid, uuid, uuid, text, uuid) to service_role;
grant execute on function public.recycle_lead_atomic(uuid, uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.send_birthday_celebration_atomic(uuid) to service_role;
notify pgrst, 'reload schema';
commit;
