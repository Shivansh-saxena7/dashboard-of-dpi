-- Rollback of 2026-11-27_employee_card_pilot_testing.sql: everyone back on the old card.
begin;
update public.lead_engine_settings set employee_card_mode = 'off', employee_card_pilot_ids = '{}' where id = 1;
commit;
