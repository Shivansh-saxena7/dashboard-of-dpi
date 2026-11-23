-- Rollback for 2026-11-23_perf_report_v3.sql (DRAFT, NOT APPLIED): drop the 6 v3 functions (roll back 2026-11-23_perf_report_reassign.sql first if it was applied). v1, v2, the snapshot and
-- the hourly refresh are untouched; the page falls back to v2.
begin;
drop function if exists public.get_lead_journey(uuid);
drop function if exists public.perf_stint_facts(uuid);
drop function if exists public.get_perf_report_leads_v3(date, date, jsonb, text, int, int);
drop function if exists public.get_perf_report_v3(date, date, jsonb);
drop function if exists public.perf_group_v3(date, date, jsonb, text);
drop function if exists public.perf_stints_in_v3(date, date, jsonb);
commit;
