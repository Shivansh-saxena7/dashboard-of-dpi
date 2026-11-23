-- APPLIED 2026-11-20 17:48 IST (live; first run 18:37 IST). The DRAFT wording below is from before the apply.
-- 2026-11-20 Admin Performance Report: hourly refresh of perf_stints. DRAFT, NOT APPLIED. Apply only after
-- 2026-11-20_perf_report.sql is live and its first full build (select public.perf_refresh(true)) has run and been
-- checked. pg_cron runs in UTC: '7 * * * *' is minute 7 UTC = :37 India time, away from the recycle sweep
-- (:00/:15/:30/:45 IST). Rollback: 2026-11-20_perf_report_cron_rollback.sql.
select cron.schedule('perf-report-refresh-hourly', '7 * * * *', $$select public.perf_refresh()$$);
