-- ROLLBACK for 2026-11-15_admin_reassign_stage_mode.sql: removes only the 4-parameter overload. Roll the frontend back
-- first (to the commit before fix/reassign-keep-stage), so the Reassign button calls the 3-parameter function again.
-- Leads already moved keep their new owner; kept-stage moves keep their lead_restore_log protection rows.
begin;

drop function public.admin_reassign_leads(uuid[], uuid, text, text);

do $$
begin
  if exists (select 1 from pg_proc where proname = 'admin_reassign_leads' and pronargs = 4) then raise exception '4-parameter function still exists'; end if;
  if not exists (select 1 from pg_proc where proname = 'admin_reassign_leads' and pronargs = 3) then raise exception 'the 3-parameter function must stay'; end if;
end $$;

commit;
