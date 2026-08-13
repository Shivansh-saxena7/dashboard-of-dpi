import { isLeadTerminal } from "./isLeadTerminal";

// Single source of truth for "what statuses can this lead move to
// next" — same pattern as the other lib/calculate*.ts files: pure
// function, fixed set of outputs, imported everywhere this decision
// is needed (the status-picker in the Lead Detail update UI, and
// nowhere else — never re-implemented inline in a component).
//
// V2_MASTER_BLUEPRINT.md Section 4.5's fixed set is:
//   NEW -> CONNECTED -> NOT_CONNECTED -> SWITCHED_OFF ->
//   NOT_INTERESTED -> CONVERTED -> JUNK
// That arrow notation reads as a strict sequence, but real call
// outcomes aren't linear (a second attempt can land on any outcome,
// not just "the next one in the list") — per the approved design,
// transitions are non-strict: any non-terminal outcome is selectable
// at any time, not a fixed next-in-line.
export type LeadStatus =
  | "NEW"
  | "CONNECTED"
  | "NOT_CONNECTED"
  | "SWITCHED_OFF"
  | "NOT_INTERESTED"
  | "CONVERTED"
  | "JUNK";

// NEW and JUNK are deliberately excluded from the selectable set:
//   - NEW means "not yet contacted" — it's a starting value, never
//     something a call outcome produces, so it's never a valid pick.
//   - JUNK is a system-decided outcome (max recycles reached, or a
//     second NOT_INTERESTED — Section 4.4), owned by the Phase 4
//     recycling engine, not a raw call result an employee logs
//     themselves.
const EMPLOYEE_SELECTABLE_STATUSES: LeadStatus[] = [
  "CONNECTED",
  "NOT_CONNECTED",
  "SWITCHED_OFF",
  "NOT_INTERESTED",
  "CONVERTED"
];

// boardStage added as a required second parameter — a lead is only
// genuinely terminal (no further employee-initiated update allowed)
// once isLeadTerminal() says so, which needs board_stage alongside
// status (status='CONVERTED' alone can mean "verbal yes, not
// genuinely booked yet" — see lib/isLeadTerminal.ts for the full
// reasoning). This used to check status IN ('CONVERTED','JUNK') on
// its own, which locked the dropdown for a lead that was still very
// much active. Both call sites (LeadDetailModal, DataDetailModal)
// updated to pass board_stage.
export function getValidNextLeadStatuses(currentStatus: LeadStatus, boardStage: string | null | undefined): LeadStatus[] {

  if (isLeadTerminal(currentStatus, boardStage)) {
    return [];
  }

  // The current status is intentionally NOT filtered out of its own
  // result — re-logging the same outcome after another attempt
  // (e.g. NOT_CONNECTED again) is a realistic, valid update.
  return EMPLOYEE_SELECTABLE_STATUSES;

}
