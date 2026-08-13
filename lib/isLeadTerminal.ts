// Single source of truth for "is this lead genuinely, permanently
// closed" — status and board_stage are deliberately independent state
// (see LeadDetailModal.tsx's own comment on that design), which means
// status==='CONVERTED' alone does NOT mean the lead is actually
// booked. log_lead_update_atomic lets an employee mark CONVERTED as a
// plain call-outcome (e.g. "client verbally agreed, formal booking
// hasn't happened yet") without ever touching board_stage — only
// log_booking_atomic (the real "Log Booking" action) sets BOTH status
// AND board_stage together. A lead is only genuinely terminal once
// board_stage has actually reached BOOKING, or once JUNK (which is
// unconditionally terminal on status alone — mark_lead_junk_atomic/
// the recycling engine own that, board_stage is irrelevant there).
//
// Before this helper existed, 9 separate places across the codebase
// each reimplemented `status IN ('CONVERTED','JUNK')` independently —
// every one of them wrong the same way, discovered via a live-data
// audit (6 real leads had status='CONVERTED' with board_stage still
// LEADS/FOLLOW_UP/VISIT). This is the fix: one function, imported
// everywhere the question "is this lead done" is asked. The SQL
// mirror is public.is_lead_terminal(status, board_stage) — same
// logic, kept in sync manually since Postgres functions can't import
// this file.
export function isLeadTerminal(status: string | null | undefined, boardStage: string | null | undefined): boolean {
  return (status === "CONVERTED" && boardStage === "BOOKING") || status === "JUNK";
}
