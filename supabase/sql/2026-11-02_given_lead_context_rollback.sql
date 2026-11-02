-- Rollback for 2026-11-02_given_lead_context.sql: removes both functions and both settings. Nothing else was touched.
-- Deploy the app without the feature first, or set the mode to 'off' and accept one PGRST202 report per page load.
begin;
drop function if exists public.get_given_lead_context();
drop function if exists public.given_lead_context_for(uuid);
alter table lead_engine_settings drop constraint if exists lead_engine_settings_given_lead_context_mode_check;
alter table lead_engine_settings
  drop column if exists given_lead_context_mode,
  drop column if exists given_lead_context_pilot_ids;
notify pgrst, 'reload schema';
commit;
