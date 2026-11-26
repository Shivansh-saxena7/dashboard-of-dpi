-- 2026-11-27 get_last_notes: latest note of each given assignment, for the redesign cards' last-note panel. DRAFT, NOT
-- APPLIED. Apply only on the owner's "haan", from an LF copy, after a rolled-back dry run, at least 2 minutes away from
-- a sweep (:00/:15/:30/:45 IST) and the refresh (:37 IST). Rollback: 2026-11-27_get_last_notes_rollback.sql.
-- Additive: one function. SECURITY INVOKER, so lead_notes' own row-level security decides what a person sees (an
-- employee: only their own notes), exactly as the old direct read did. Ids come in the POST body (never in a URL), at
-- most 200 a call (more are ignored). Uses lead_notes_lead_history_id_idx. No write.
begin;
create or replace function public.get_last_notes(p_history_ids uuid[])
returns table (lead_history_id uuid, note text, created_at timestamptz)
language sql stable security invoker set search_path to 'public' as $$
  select distinct on (n.lead_history_id) n.lead_history_id, n.note, n.created_at
  from lead_notes n
  where n.lead_history_id = any (coalesce(p_history_ids[1:200], '{}'::uuid[]))
  order by n.lead_history_id, n.created_at desc, n.id desc
$$;
revoke all on function public.get_last_notes(uuid[]) from public, anon;
grant execute on function public.get_last_notes(uuid[]) to authenticated, service_role;
commit;
