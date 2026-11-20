-- Rollback for 2026-11-20_perf_report.sql (DRAFT, NOT APPLIED). Removes only what that file added. Run the cron
-- rollback (2026-11-20_perf_report_cron_rollback.sql) first if the hourly job was scheduled.
begin;
drop function if exists public.get_perf_report_leads(date, date, jsonb, text, int, int);
drop function if exists public.get_perf_report(date, date, jsonb);
drop function if exists public.perf_stints_in(date, date, jsonb);
drop function if exists public.perf_refresh(boolean);
drop function if exists public.perf_source(text);
drop table if exists public.perf_stints;
drop table if exists public.perf_definitions;
drop table if exists public.perf_source_map;
commit;
