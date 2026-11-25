-- Rollback of 2026-11-26_perf_lead_journey.sql: drops the Lead Journey functions and the definitions v3 rows. Nothing else.
begin;
drop function if exists public.get_perf_journey_rows(date, date, jsonb, text, uuid, int, int);
drop function if exists public.get_perf_journey(date, date, jsonb);
drop function if exists public.perf_journey_json(date, date, jsonb, text, uuid, int, int, boolean);
drop function if exists public.perf_journey_pct(jsonb);
drop function if exists public.perf_journey_stints_v1(date, date, jsonb);
delete from public.perf_definitions where version = 3;
commit;
