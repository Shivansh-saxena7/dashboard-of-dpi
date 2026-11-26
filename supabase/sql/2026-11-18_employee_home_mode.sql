-- NOT APPLIED. DRAFT 2026-11-18 (feature/home-p1-tiles). Apply only on the owner's "haan", from an LF copy
-- (git cat-file -p), CR count 0, rolled-back dry run first, at least 2 minutes away from a sweep (:00/:15/:30/:45).
-- Employee Home Phase 1 flag. Additive only: two columns on the one-row lead_engine_settings table, default off.
--   employee_home_mode      'off' (old Home, default) | 'admin_pilot' (only employee_home_pilot_ids) | 'on' (everyone)
--   employee_home_pilot_ids employees.id values that see the new Home while the mode is 'admin_pilot'
-- The app reads the row with select("*"): before this is applied the columns are missing and the Home stays old.
-- No function, grant, policy, lead data or calculation is changed. Rollback: 2026-11-18_employee_home_mode_rollback.sql.
-- Switch (after apply, each on its own "haan"):
--   pilot: update lead_engine_settings set employee_home_mode = 'admin_pilot', employee_home_pilot_ids = array['<employee uuid>']::uuid[] where id = 1;
--   all:   update lead_engine_settings set employee_home_mode = 'on' where id = 1;
--   off:   update lead_engine_settings set employee_home_mode = 'off' where id = 1;
begin;

alter table public.lead_engine_settings
  add column if not exists employee_home_mode text not null default 'off'
    constraint lead_engine_settings_employee_home_mode_check check (employee_home_mode in ('off', 'admin_pilot', 'on')),
  add column if not exists employee_home_pilot_ids uuid[] not null default '{}'::uuid[];

do $$
begin
  if (select employee_home_mode from public.lead_engine_settings where id = 1) is distinct from 'off' then
    raise exception 'employee_home_mode is not off after apply';
  end if;
end $$;

commit;
