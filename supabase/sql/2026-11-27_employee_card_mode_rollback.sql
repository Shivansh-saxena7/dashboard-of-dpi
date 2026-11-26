-- Rollback of 2026-11-27_employee_card_mode.sql: drops the two columns (the app then shows the old card to everyone).
begin;
alter table public.lead_engine_settings drop column if exists employee_card_pilot_ids, drop column if exists employee_card_mode;
commit;
