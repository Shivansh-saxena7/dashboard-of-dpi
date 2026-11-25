-- Rollback for 2026-11-25_perf_report_v4.sql (DRAFT, NOT APPLIED): drop the v4 functions and the definitions v2 rows.
-- The page falls back to v3 (definitions v1).
begin;
drop function if exists public.get_perf_report_leads_v4(date, date, jsonb, text, int, int);
drop function if exists public.get_perf_report_v4(date, date, jsonb);
drop function if exists public.perf_merge_rows_v4(jsonb, date, date, jsonb, text, text, text[]);
drop function if exists public.perf_merge_v4(jsonb, jsonb, text[]);
drop function if exists public.perf_event_group_v4(date, date, jsonb, text);
drop function if exists public.perf_event_rows_v4(date, date, jsonb);
delete from public.perf_definitions where version = 2;
commit;
