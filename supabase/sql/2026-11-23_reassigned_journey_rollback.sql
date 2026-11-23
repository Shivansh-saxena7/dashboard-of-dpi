-- Rollback for 2026-11-23_reassigned_journey.sql (DRAFT, NOT APPLIED): drop the functions and the two settings columns.
-- The cards then show nothing extra (missing column = off on the page).
begin;
drop function if exists public.get_reassigned_lead_context(uuid);
drop function if exists public.get_my_reassigned_leads();
drop function if exists public.reassigned_stint_origin(uuid);
drop function if exists public.reassigned_journey_allowed(uuid);
alter table public.lead_engine_settings drop column if exists reassigned_journey_pilot_ids;
alter table public.lead_engine_settings drop column if exists reassigned_journey_mode;
commit;
