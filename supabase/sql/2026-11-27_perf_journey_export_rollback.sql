-- Rollback of 2026-11-27_perf_journey_export.sql: drops the 2 export functions. Nothing else.
begin;
drop function if exists public.get_perf_journey_export(date, date, jsonb, int, int);
drop function if exists public.perf_journey_export_json(date, date, jsonb, int, int);
commit;
