-- Rollback for 2026-11-23_perf_report_reassign.sql (DRAFT, NOT APPLIED): drop its functions and the two batch tables.
-- Leads already moved stay with their new owners (their lead_history rows are real assignments); run
-- admin_undo_report_batch for a batch first if it should be undone. Turn the page flag off first
-- (2026-11-23_admin_report_reassign_mode_rollback.sql).
begin;
drop function if exists public.get_report_batch_outcome(uuid);
drop function if exists public.get_report_batches(date, date);
drop function if exists public.get_lead_report_batches(uuid);
drop function if exists public.admin_undo_report_batch(uuid, text, text);
drop function if exists public.admin_reassign_leads_from_report(jsonb, uuid, text, text, text, boolean, text);
drop function if exists public.admin_report_reassign_preview(jsonb, uuid, text, boolean);
drop function if exists public.perf_reassign_verdict(uuid, uuid, uuid, text, boolean);
drop function if exists public.perf_reassign_check_items(jsonb);
drop function if exists public.perf_reassign_enabled();
drop function if exists public.perf_reassign_receiver_problem(uuid);
drop function if exists public.perf_lead_is_positive(text, text);
drop table if exists public.perf_reassign_batch_leads;
drop table if exists public.perf_reassign_batches;
commit;
