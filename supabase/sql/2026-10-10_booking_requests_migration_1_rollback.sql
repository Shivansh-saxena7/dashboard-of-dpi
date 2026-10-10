-- RECORD ONLY. Not applied. Undoes 2026-10-10_booking_requests_migration_1.sql if ever needed.

-- ROLLBACK for Migration 1 (only if needed): removes everything it added. Nothing else depends on it.
-- If any request is still PENDING, its lead keeps the 'Booking pending approval' pause; clear it first:
update lead_history h
set paused_until = r.prev_paused_until, pause_reason = r.prev_pause_reason, pause_note = r.prev_pause_note
from booking_requests r
where r.status = 'PENDING' and h.lead_id = r.lead_id and h.employee_id = r.employee_id and h.is_active = true
  and h.pause_note = 'Booking pending approval';
drop function if exists public.reject_booking_atomic(uuid, text);
drop function if exists public.approve_booking_atomic(uuid, integer);
drop function if exists public.request_booking_atomic(uuid, text, text);
drop function if exists public.book_lead_internal(uuid, uuid, integer, text);
drop table if exists public.booking_requests;
