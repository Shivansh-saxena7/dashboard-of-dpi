-- 2026-11-27 Pilot: the redesign card for the "testing" employee only. DRAFT, NOT APPLIED. Run only on the owner's
-- separate "haan", after 2026-11-27_employee_card_mode.sql, in a window away from the sweeps. Looks the employee up by
-- name; changes nothing unless exactly one active employee matches and the mode is still 'off'.
-- Rollback: 2026-11-27_employee_card_pilot_testing_rollback.sql.
begin;
update public.lead_engine_settings
set employee_card_mode = 'admin_pilot',
    employee_card_pilot_ids = array[(select id from public.employees where name ilike '%testing%' and is_active)]
where id = 1 and employee_card_mode = 'off'
  and (select count(*) from public.employees where name ilike '%testing%' and is_active) = 1
returning employee_card_mode, cardinality(employee_card_pilot_ids) as pilots;
commit;
