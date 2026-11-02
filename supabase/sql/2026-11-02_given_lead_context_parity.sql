-- Read-only parity for the "Given by admin" context, after 2026-11-02_given_lead_context.sql. Writes nothing.
-- Compares the function with the same conditions written directly, for every lead with an open given window.
with direct as (
  select distinct on (h.id) h.lead_id, h.employee_id,
    h.call_count = 0 and h.first_call_at is null and (h.outcome_at is null or h.outcome_at <= h.assigned_at + interval '2 seconds')
      and not exists (select 1 from lead_activity_log a where a.lead_history_id = h.id and a.activity_type = 'STATUS_UPDATE') in_filter
  from lead_history h
  join leads l on l.id = h.lead_id and l.current_owner_id = h.employee_id
  join lead_restore_log r on r.new_lead_history_id = h.id and r.undone_at is null and r.protected_until > now()
  where h.is_active
  order by h.id
),
fn as (
  select e.id employee_id, (x->>'lead_id')::uuid lead_id, x
  from employees e
  cross join lateral jsonb_array_elements(given_lead_context_for(e.id)->'leads') x
)
select json_build_object(
  'direct_leads', (select count(*) from direct),
  'function_leads', (select count(*) from fn),
  'missing_from_function', (select count(*) from direct d where not exists (select 1 from fn f where f.lead_id = d.lead_id and f.employee_id = d.employee_id)),
  'extra_in_function', (select count(*) from fn f where not exists (select 1 from direct d where d.lead_id = f.lead_id and d.employee_id = f.employee_id)),
  'direct_in_filter', (select count(*) from direct where in_filter),
  'function_in_filter', (select count(*) from fn where (x->>'in_filter')::boolean),
  'filter_mismatch', (select count(*) from fn f join direct d on d.lead_id = f.lead_id where (f.x->>'in_filter')::boolean is distinct from d.in_filter),
  'by_type', (select json_object_agg(t, c) from (select x->>'lead_type' t, count(*) c from fn group by 1) z),
  'box_with_last_positive', (select count(*) from fn where x->'last_positive' <> 'null'::jsonb),
  'box_no_last_positive', (select count(*) from fn where x->'last_positive' = 'null'::jsonb),
  'note_exact', (select count(*) from fn where x#>>'{note,match}' = 'exact'),
  'note_other_time', (select count(*) from fn where x#>>'{note,match}' = 'other_time'),
  'no_note', (select count(*) from fn where x->'note' = 'null'::jsonb),
  'is_you', (select count(*) from fn where x#>>'{last_positive,is_you}' = 'true'),
  'with_your_notes', (select count(*) from fn where jsonb_array_length(x->'your_notes') > 0),
  'with_after', (select count(*) from fn where x->'after' <> 'null'::jsonb),
  'by_owner', (select json_object_agg(n, json_build_object('box', b, 'filter', c)) from (
     select split_part(e.name, ' ', 1) n, count(*) b, count(*) filter (where (f.x->>'in_filter')::boolean) c from fn f join employees e on e.id = f.employee_id group by 1) z)
) j;
