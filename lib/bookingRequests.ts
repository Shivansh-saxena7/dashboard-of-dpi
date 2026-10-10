// Booking request -> approval (2026-10-10). An employee no longer books a lead
// directly: request_booking_atomic records a request and holds the lead with
// the same pause a pending visit uses (pause_reason VISIT_PENDING_VERIFICATION),
// tagged with this note so the app can tell the two apart. Admin / Super Admin /
// Sales Coordinator approve (approve_booking_atomic) or reject with a reason
// (reject_booking_atomic). Display helpers only — no rule lives here.

export const BOOKING_PENDING_NOTE = "Booking pending approval";

export function isBookingPending(pauseReason: string | null | undefined, pauseNote: string | null | undefined): boolean {
  return pauseReason === "VISIT_PENDING_VERIFICATION" && pauseNote === BOOKING_PENDING_NOTE;
}
