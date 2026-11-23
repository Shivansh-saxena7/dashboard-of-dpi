-- Rollback for 2026-11-23_perf_report_v2.sql (DRAFT, NOT APPLIED): drop the 3 v2 functions. The v1 report, its
-- tables and the hourly refresh are untouched; the page falls back to v1.
begin;
drop function if exists public.get_perf_report_leads_v2(date, date, jsonb, text, int, int);
drop function if exists public.get_perf_report_v2(date, date, jsonb);
drop function if exists public.perf_group_v2(date, date, jsonb, text);
commit;
