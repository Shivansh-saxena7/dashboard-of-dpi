-- NOT APPLIED. DRAFT 2026-11-19 (feature/admin-home-a1). Apply only on the owner's "haan", from an LF copy
-- (git cat-file -p), CR count 0, rolled-back dry run first, at least 2 minutes away from a sweep (:00/:15/:30/:45).
-- Admin Home A1 flag. Additive only: two columns on the one-row lead_engine_settings table, default off.
--   admin_home_mode      'off' (old dashboard, default) | 'admin_pilot' (only admin_home_pilot_ids) | 'on' (all admins)
--   admin_home_pilot_ids employees.id values (admin / super_admin) that see the new Admin Home in 'admin_pilot'
-- The app reads the row with select("*"): before this is applied the columns are missing and the old dashboard shows.
-- No function, grant, policy, lead data or calculation is changed. Rollback: 2026-11-19_admin_home_mode_rollback.sql.
-- Switch (after apply, each on its own "haan"):
--   pilot: update lead_engine_settings set admin_home_mode = 'admin_pilot', admin_home_pilot_ids = array['<employee uuid>']::uuid[] where id = 1;
--   all:   update lead_engine_settings set admin_home_mode = 'on' where id = 1;
--   off:   update lead_engine_settings set admin_home_mode = 'off' where id = 1;
begin;

alter table public.lead_engine_settings
  add column if not exists admin_home_mode text not null default 'off'
    constraint lead_engine_settings_admin_home_mode_check check (admin_home_mode in ('off', 'admin_pilot', 'on')),
  add column if not exists admin_home_pilot_ids uuid[] not null default '{}'::uuid[];

do $$
begin
  if (select admin_home_mode from public.lead_engine_settings where id = 1) is distinct from 'off' then
    raise exception 'admin_home_mode is not off after apply';
  end if;
end $$;

commit;
