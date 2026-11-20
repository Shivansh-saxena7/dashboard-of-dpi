-- Rollback for 2026-11-20_perf_report_cron.sql (DRAFT, NOT APPLIED): stop the hourly refresh.
select cron.unschedule('perf-report-refresh-hourly');
