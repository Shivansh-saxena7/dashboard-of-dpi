// Admin card parity fixture (2026-11-27 admin card port): one fake lead per scenario of
// C:/work/reports/admin_card_parity/PARITY_ADMIN.md section 1.4, in the shape /admin/leads and /coordinator read
// (leads + employees(name) + pending_team(name) + active lead_history). Fake names and numbers only. Fixed clock T0.

export const T0 = new Date("2026-11-25T05:30:00Z");
const ago = (days: number) => new Date(T0.getTime() - days * 86400e3).toISOString();
export const OWNER = "00000000-0000-4000-8000-0000000000e3";
export const OWNER_ON_LEAVE = "00000000-0000-4000-8000-0000000000e5";
export const RECEIVER = "00000000-0000-4000-8000-0000000000e4";
export const TEAM = { id: "00000000-0000-4000-8000-00000000aa01", name: "Team Alpha" };

type Over = Record<string, unknown> & { lh?: Record<string, unknown> };
let n = 0;
function row(label: string, over: Over = {}) {
  n += 1;
  const nn = String(n).padStart(2, "0");
  const { lh = {}, ...lead } = over;
  return [
    label,
    {
      id: `00000000-0000-4000-8000-0000000c00${nn}`,
      name: `Admin Lead ${nn}`,
      mobile: `90000100${nn}`,
      project: "Test Project",
      source: "Meta",
      catcher_name: null,
      status: "NEW",
      priority: "warm",
      board_stage: "LEADS",
      board_stage_changed_at: null,
      sla_deadline: null,
      recycle_count: 0,
      created_at: ago(20),
      current_owner_id: OWNER,
      pending_team_id: null,
      lead_type: "LEAD",
      is_personal_lead: false,
      employees: { name: "Owner One" },
      pending_team: null,
      ...lead,
      lead_history: [
        {
          id: `00000000-0000-4000-8000-0000000d00${nn}`,
          is_active: true,
          assigned_at: ago(10),
          first_call_at: null,
          first_whatsapp_at: null,
          assigned_by_type: "SYSTEM",
          call_count: 0,
          last_activity_at: ago(0.2),
          paused_until: null,
          pause_reason: null,
          pause_note: null,
          outcome_at: null,
          recycle_reason: null,
          recycled_from_status: null,
          recycled_from_stage: null,
          assigned_by: null,
          ...lh
        }
      ]
    }
  ] as const;
}

export const ADMIN_SCENARIOS = [
  row("S1 new lead, Leads stage, no calls"),
  row("S2 called 3 times", { status: "CONNECTED", lh: { call_count: 3, outcome_at: ago(0.2) } }),
  row("S3 follow-up, idle 3.5 days (warning)", { status: "CONNECTED", board_stage: "FOLLOW_UP", lh: { call_count: 2, last_activity_at: ago(3.5), outcome_at: ago(3.5) } }),
  row("S4 follow-up, idle 7 days (recycling now)", { status: "CONNECTED", board_stage: "FOLLOW_UP", priority: "hot", lh: { call_count: 4, last_activity_at: ago(7), outcome_at: ago(7) } }),
  row("S5 Leads-stage not-connected cooldown", { status: "NOT_CONNECTED", recycle_count: 1, lh: { call_count: 1, last_activity_at: ago(0.5), outcome_at: ago(0.5) } }),
  row("S6 visit lock", { status: "CONNECTED", board_stage: "VISIT", lh: { paused_until: ago(-5), pause_reason: "VISIT_LOCK", last_activity_at: ago(1) } }),
  row("S7 snoozed", { status: "CONNECTED", board_stage: "FOLLOW_UP", lh: { paused_until: ago(-2), pause_reason: "SNOOZE", last_activity_at: ago(1) } }),
  row("S8 visit pending verification past its date", { status: "CONNECTED", board_stage: "VISIT", lh: { paused_until: ago(1), pause_reason: "VISIT_PENDING_VERIFICATION", last_activity_at: ago(4) } }),
  row("S9 owner on leave (+ snooze)", { status: "CONNECTED", board_stage: "FOLLOW_UP", current_owner_id: OWNER_ON_LEAVE, employees: { name: "Owner Leave" }, lh: { last_activity_at: ago(8) } }),
  row("S10 personal lead", { is_personal_lead: true, source: "Personal", status: "CONNECTED", board_stage: "FOLLOW_UP", lh: { last_activity_at: ago(9) } }),
  row("S11 JUNK", { status: "JUNK", recycle_count: 3, lh: { recycle_reason: "NOT_CONNECTED_COOLDOWN", recycled_from_status: "NOT_CONNECTED", recycled_from_stage: "LEADS" } }),
  row("S12 booked", { status: "CONVERTED", board_stage: "BOOKING", lh: { last_activity_at: ago(12) } }),
  row("S12b converted but not booked (not terminal)", { status: "CONVERTED", board_stage: "VISIT", lh: { last_activity_at: ago(3.2) } }),
  row("S13 DATA", { lead_type: "DATA", source: "Housing", lh: { call_count: 2 } }),
  row("S14 unowned, reserved for a team", { current_owner_id: null, employees: null, pending_team_id: TEAM.id, pending_team: { name: TEAM.name } }),
  row("S15 unowned, no team", { current_owner_id: null, employees: null }),
  row("S16 recycled 2x with reason", { recycle_count: 2, status: "CONNECTED", lh: { recycle_reason: "FOLLOWUP_INACTIVITY", recycled_from_status: "CONNECTED", recycled_from_stage: "FOLLOW_UP" } }),
  row("S17 existing client (siblings)", { status: "CONNECTED" }),
  row("S18 catcher", { catcher_name: "Catcher Kumar", source: "Catcher" }),
  row("S19 legacy", { source: "Legacy", status: "CONNECTED" }),
  row("S22 nulls: project, source, assigned, last activity", { project: null, source: null, lh: { assigned_at: null, last_activity_at: null } }),
  row("S23 empty name", { name: "", status: "NEW" }),
  row("S24 cold priority, long project name", { priority: "cold", project: "A Very Long Project Name That Should Wrap On A Phone Card Without Being Cut" }),
  row("S25 high calls, follow-up warning with snooze ended", { status: "CONNECTED", board_stage: "FOLLOW_UP", lh: { call_count: 12, paused_until: ago(1), pause_reason: "SNOOZE", last_activity_at: ago(3.1) } })
] as const;

// S17: siblings answer for that lead (get_lead_siblings).
export const SIBLINGS: Record<string, { lead_id: string; project: string | null; status: string; owner_name: string | null; is_mine: boolean }[]> = {
  [ADMIN_SCENARIOS[17][1].id]: [
    { lead_id: "00000000-0000-4000-8000-0000000c0f01", project: "Other Project", status: "NEW", owner_name: "Owner Two", is_mine: false },
    { lead_id: "00000000-0000-4000-8000-0000000c0f02", project: null, status: "JUNK", owner_name: null, is_mine: false }
  ]
};
// Last notes (get_last_notes) for two assignments; the rest have none.
export const NOTES: Record<string, string> = {
  [ADMIN_SCENARIOS[1][1].lead_history[0].id]: "Asked to call back after lunch",
  [ADMIN_SCENARIOS[2][1].lead_history[0].id]: "Wants a site visit next week"
};
