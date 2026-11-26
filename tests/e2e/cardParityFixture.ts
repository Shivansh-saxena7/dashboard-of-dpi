// Scenario leads for the card parity spec (card-parity.spec.ts): the rows of C:/work/reports/card_parity/PARITY.md,
// section B, as list data. Fake names and numbers only. Times are relative to a fixed clock (T0).
type Row = Record<string, unknown>;
export const T0 = Date.parse("2026-11-25T05:30:00Z"); // Wednesday 11:00 IST (weekly off in the mock is Tuesday)
const iso = (ms: number) => new Date(T0 + ms).toISOString();
const M = 60_000, H = 60 * M, D = 24 * H;

function lead(type: "LEAD" | "DATA", id: string, o: Row = {}, h: Row = {}): Row {
  return {
    id,
    name: `${type === "LEAD" ? "Parity Lead" : "Parity Data"} ${id}`,
    mobile: `9${String(Math.abs(hash(id))).padStart(9, "0").slice(0, 9)}`,
    project: "Test Project",
    source: "Test Source",
    catcher_name: null,
    status: "NEW",
    priority: "warm",
    board_stage: "LEADS",
    sla_deadline: null,
    recycle_count: 0,
    created_at: iso(-2 * H),
    is_personal_lead: false,
    lead_type: type,
    lead_history: [
      {
        id: `h-${id}`,
        call_count: 0,
        outcome_at: null,
        assigned_at: iso(-40 * M),
        first_call_at: null,
        first_whatsapp_at: null,
        assigned_by_type: "SYSTEM",
        assigned_by: null,
        reassign_note: null,
        recycle_reason: null,
        recycled_from_status: null,
        recycled_from_stage: null,
        last_activity_at: null,
        last_call_click_at: null,
        paused_until: null,
        pause_reason: null,
        pause_note: null,
        pause_verified_at: null,
        pause_verified_by: null,
        is_active: true,
        employee_id: "00000000-0000-4000-8000-0000000000e1",
        ...h
      }
    ],
    ...o
  };
}
function hash(s: string) {
  let x = 7;
  for (const c of s) x = (x * 31 + c.charCodeAt(0)) | 0;
  return x;
}

// [scenario id, what it is, lead]
export const LEAD_SCENARIOS: [string, string, Row][] = [
  ["S01", "new, within first-call time", lead("LEAD", "p-s01", { sla_deadline: iso(80 * M), priority: "hot" })],
  ["S02", "new, overdue", lead("LEAD", "p-s02", { sla_deadline: iso(-2 * H), priority: "cold" })],
  ["S03", "called, status still new", lead("LEAD", "p-s03", { sla_deadline: iso(30 * M) }, { call_count: 1, last_activity_at: iso(-20 * M) })],
  ["S04", "connected, follow-up clock fresh", lead("LEAD", "p-s04", { status: "CONNECTED" }, { call_count: 2, last_activity_at: iso(-1 * D), outcome_at: iso(-1 * D) })],
  ["S05", "follow-up stage, 4 days quiet", lead("LEAD", "p-s05", { status: "CONNECTED", board_stage: "FOLLOW_UP" }, { call_count: 3, last_activity_at: iso(-4 * D) })],
  ["S06", "follow-up stage, 9 days quiet", lead("LEAD", "p-s06", { status: "CONNECTED", board_stage: "FOLLOW_UP" }, { call_count: 3, last_activity_at: iso(-9 * D) })],
  ["S07", "not connected, in cooldown", lead("LEAD", "p-s07", { status: "NOT_CONNECTED" }, { call_count: 1, outcome_at: iso(-2 * H) })],
  ["S08", "not connected, cooldown over", lead("LEAD", "p-s08", { status: "NOT_CONNECTED" }, { call_count: 1, outcome_at: iso(-12 * D) })],
  ["S09", "recycled 3 times, due", lead("LEAD", "p-s09", { status: "SWITCHED_OFF", recycle_count: 3 }, { call_count: 1, outcome_at: iso(-12 * D), recycle_reason: "SLA_BREACHED" })],
  ["S10", "visit lock", lead("LEAD", "p-s10", { status: "CONNECTED", board_stage: "VISIT" }, { call_count: 4, last_activity_at: iso(-2 * D), paused_until: iso(20 * D), pause_reason: "VISIT_LOCK" })],
  ["S11", "visit pending verification", lead("LEAD", "p-s11", { status: "CONNECTED", board_stage: "VISIT" }, { call_count: 4, paused_until: iso(2 * D), pause_reason: "VISIT_PENDING_VERIFICATION" })],
  ["S12", "booking pending (no booking chip)", lead("LEAD", "p-s12", { status: "CONNECTED", board_stage: "VISIT" }, { call_count: 4, paused_until: iso(2 * D), pause_reason: "VISIT_PENDING_VERIFICATION", pause_note: "Booking pending approval" })],
  ["S13", "snoozed", lead("LEAD", "p-s13", { status: "CONNECTED" }, { call_count: 2, last_activity_at: iso(-1 * H), paused_until: iso(3 * D), pause_reason: "SNOOZE" })],
  ["S13b", "sibling hold", lead("LEAD", "p-s13b", {}, { paused_until: iso(5 * D), pause_reason: "SIBLING_HOLD" })],
  ["S17", "given by admin", lead("LEAD", "p-s17", { sla_deadline: iso(50 * M) }, { assigned_by_type: "ADMIN" })],
  ["S18", "previously with (report give)", lead("LEAD", "p-s18", { sla_deadline: iso(60 * M) }, { assigned_by_type: "ADMIN" })],
  ["S19", "reassigned by team leader", lead("LEAD", "p-s19", { sla_deadline: iso(70 * M) }, { assigned_by_type: "TEAM_LEADER", assigned_by: { name: "Team Lead X" }, reassign_note: "Call after 5 pm" })],
  ["S22", "sibling lead (existing client)", lead("LEAD", "p-s22", { sla_deadline: iso(90 * M) })],
  ["S23", "personal lead", lead("LEAD", "p-s23", { is_personal_lead: true, source: "Personal", priority: "cold" })],
  ["S24", "recycled before", lead("LEAD", "p-s24", { recycle_count: 2, sla_deadline: iso(100 * M) }, { recycle_reason: "FOLLOWUP_INACTIVITY_RECYCLE_READY", recycled_from_stage: "FOLLOW_UP", recycled_from_status: "CONNECTED" })],
  ["S25", "junk", lead("LEAD", "p-s25", { status: "JUNK" })],
  ["S26", "converted and booked", lead("LEAD", "p-s26", { status: "CONVERTED", board_stage: "BOOKING" }, { call_count: 6, last_activity_at: iso(-3 * D) })],
  ["S28", "legacy source + catcher", lead("LEAD", "p-s28", { source: "Legacy", catcher_name: "Catcher Q", sla_deadline: iso(110 * M) })],
  ["S31", "long text", lead("LEAD", "p-s31", { name: "Parity long test client name that keeps going and going past one line", project: "An extremely long project name for the wrapping test", catcher_name: "A rather long catcher name", sla_deadline: iso(120 * M) }, { assigned_by_type: "TEAM_LEADER", assigned_by: { name: "Team Lead X" }, reassign_note: "A long note from the team leader that should wrap neatly on a phone screen" })],
  ["S33", "missing project / source / times", lead("LEAD", "p-s33", { project: null, source: null }, { assigned_at: null })]
];
export const DATA_SCENARIOS: [string, string, Row][] = [
  ["S34", "data new, no calls", lead("DATA", "p-d34", { project: null })],
  ["S35", "data 2 calls", lead("DATA", "p-d35", { status: "NOT_CONNECTED", project: null }, { call_count: 2 })],
  ["S36", "data 3 calls, last attempt", lead("DATA", "p-d36", { status: "SWITCHED_OFF", project: null }, { call_count: 3 })],
  ["S37a", "data follow-up", lead("DATA", "p-d37a", { status: "CONNECTED", board_stage: "FOLLOW_UP", project: null }, { call_count: 2 })],
  ["S37b", "data visit", lead("DATA", "p-d37b", { status: "CONNECTED", board_stage: "VISIT", project: null }, { call_count: 3 })],
  ["S37c", "data booked", lead("DATA", "p-d37c", { status: "CONVERTED", board_stage: "BOOKING", project: null }, { call_count: 5 })],
  ["S38", "data unknown stage", lead("DATA", "p-d38", { status: "CONNECTED", board_stage: "NEGOTIATION", project: null }, { call_count: 1 })],
  ["S39", "data previously with", lead("DATA", "p-d39", { project: null })],
  ["S41", "data long name, no source", lead("DATA", "p-d41", { name: "Parity long data client name that keeps going past one line for wrapping", source: null, project: null })]
];
export const TAGGED = ["p-s18", "p-d39"];
export const SIBLINGS: Record<string, unknown> = { "p-s22": [{ id: "x", project: "Other Project", is_mine: false, owner_name: "Employee R" }] };
export const NOTES: Record<string, { note: string; at: string }> = { "h-p-s05": { note: "Client asked to call back after Diwali, wants 2 BHK near the station", at: iso(-4 * D) } };
