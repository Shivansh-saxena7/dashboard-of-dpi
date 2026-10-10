-- RECORD ONLY. Applied manually to the live database on 2026-10-10 (after backup + BEGIN ... ROLLBACK test).
-- Undid one accidental booking (lead ebea1018...). Re-running it aborts by itself: the lead is no longer in BOOKING.
-- Backup of the affected rows was kept outside the repo (it contains client data).

-- APPLY: undo the accidental booking of lead ebea1018 (2026-10-10). Aborts unless exactly 1 lead / 1 BOOKED row / 12 notifications match.
begin;

create temp table _fix_lead on commit drop as
  select id from leads where id::text like 'ebea1018%' and board_stage = 'BOOKING' and status = 'CONVERTED';
create temp table _fix_visit on commit drop as
  select sv.id from site_visits sv join _fix_lead l on l.id = sv.lead_id
  where sv.event_type = 'BOOKED' and sv.id::text like '714578b1%';
create temp table _fix_notes on commit drop as
  select n.id from notification n
  where n.type = 'BOOKING_CELEBRATION'
    and n.created_at between timestamptz '2026-10-10 10:55:00+05:30' and timestamptz '2026-10-10 10:58:00+05:30'
    and n.message like '%Tanu Mishra%just closed a booking%';

do $$
begin
  if (select count(*) from _fix_lead) <> 1 or (select count(*) from _fix_visit) <> 1 or (select count(*) from _fix_notes) <> 12 then
    raise exception 'booking fix aborted: unexpected match counts (lead %, visit %, notifications %)',
      (select count(*) from _fix_lead), (select count(*) from _fix_visit), (select count(*) from _fix_notes);
  end if;
end $$;

update leads set status = 'NEW', board_stage = 'LEADS', board_stage_changed_at = now() where id in (select id from _fix_lead);
delete from site_visits where id in (select id from _fix_visit);
delete from notification where id in (select id from _fix_notes);

select 'applied' as step,
  (select status || '/' || board_stage from leads where id in (select id from _fix_lead)) as lead_state,
  (select count(*) from site_visits sv where sv.lead_id in (select id from _fix_lead) and sv.event_type = 'BOOKED') as booked_rows_left,
  (select count(*) from notification where id in (select id from _fix_notes)) as notifications_left,
  (select count(*) from leads where board_stage = 'BOOKING') as booking_leads_total;

commit;
