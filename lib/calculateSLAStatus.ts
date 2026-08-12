// Single source of truth for lead SLA / recycle-readiness state.
// Same pattern as components/calculateStatus.ts — one function, fixed
// set of string outputs, imported everywhere this decision is needed
// (assignment engine, recycling Edge Function, SLA countdown UI).

export type SLAStatus =
  | "WITHIN_SLA"
  | "SLA_BREACHED"
  | "COOLDOWN"
  | "RECYCLE_READY"
  | "DATA_MAX_ATTEMPTS_REACHED"
  | "JUNK_ELIGIBLE"
  | "PAUSED"
  | "FOLLOWUP_WITHIN_WINDOW"
  | "FOLLOWUP_INACTIVITY_WARNING"
  | "FOLLOWUP_INACTIVITY_RECYCLE_READY"
  | "NOT_APPLICABLE";

// Cooldown windows from V2_MASTER_BLUEPRINT.md Section 4.4.
// NOT_CONNECTED / SWITCHED_OFF are specified as a "2-3 day" range —
// picked 3 days here, adjust if a different value was intended.
export const RECYCLE_COOLDOWN_DAYS = {
  NOT_CONNECTED: 3,
  SWITCHED_OFF: 3,
  NOT_INTERESTED: 7,
} as const;

export const MAX_RECYCLES = 3;
export const MAX_NOT_INTERESTED = 2;

// "Data" leads (lead_type='DATA') recycle on attempt-count, not time
// — see the branch below. 4 failed contact attempts (call_count) with
// the lead still unreached is what triggers it.
export const MAX_DATA_ATTEMPTS = 4;

// Follow-up-Stale-Recycling: once a lead has left the LEADS board
// column (Follow-up/Visit), first contact has already happened and
// the employee has manually moved it forward — the fixed-clock SLA/
// cooldown machinery below stops meaning anything for it (see the
// board_stage branch). Genuine neglect from that point on is measured
// by actual inactivity (last_activity_at) instead of a timer.
export const FOLLOWUP_INACTIVITY_WARNING_DAYS = 3;
export const FOLLOWUP_INACTIVITY_RECYCLE_DAYS = 6;

interface LeadForSLA {
  status: string;
  sla_deadline: string | null;
  recycle_count: number;
  // Both optional and omitted by every pre-existing caller — absent
  // (or anything other than "DATA") behaves exactly like a LEAD
  // always has, so this is fully backward-compatible.
  lead_type?: string;
  call_count?: number;
  // Follow-up-Stale-Recycling additions — all optional/omitted
  // behaves exactly like before (board_stage absent = treated as
  // "LEADS", paused_until absent = never paused), so every
  // pre-existing caller stays correct without passing these.
  board_stage?: string | null;
  paused_until?: string | null;
  last_activity_at?: string | null;
  pause_reason?: string | null;
  // When present, lets the NEW-status 2h clock be graduated out of by
  // ANY genuine activity (call/WhatsApp click, a note, a status log)
  // — not just a formal board move or a CONNECTED mark. Omitted by
  // any caller that doesn't have it handy behaves exactly like before
  // (never graduates early, same as pre-existing behavior).
  assigned_at?: string | null;
}

export function calculateSLAStatus(
  lead: LeadForSLA,
  lastOutcomeAt: string | null,
  notInterestedCount: number = 0
): SLAStatus {

  const now = new Date();

  if (lead.status === "CONVERTED" || lead.status === "JUNK") {
    return "NOT_APPLICABLE";
  }

  // Deliberately excludes status === "CONNECTED" OR a board_stage that
  // has moved past "LEADS" — recycle_count/notInterestedCount are
  // HISTORY (how many times this lead bounced between employees
  // before someone finally reached the client, or was manually
  // organized into Follow-up/Visit). Once genuine progress like
  // either of those has happened, that history shouldn't
  // retroactively destroy it — without this guard, a lead that took
  // 3 recycles to finally connect (or get moved to Follow-up/Visit,
  // even without a formal CONNECTED status-mark) got auto-JUNKed by
  // the very next recycle-stale-leads sweep, purely because of a
  // count that predates the actual progress. A lead still unreached
  // AND still sitting in the LEADS column after MAX_RECYCLES attempts
  // is exactly what this was designed to catch, and still does.
  if (
    lead.status !== "CONNECTED" &&
    !(lead.board_stage && lead.board_stage !== "LEADS") &&
    (lead.recycle_count >= MAX_RECYCLES || notInterestedCount >= MAX_NOT_INTERESTED)
  ) {
    return "JUNK_ELIGIBLE";
  }

  // Pending Coordinator verification of a just-marked visit — stays
  // PAUSED for as long as this reason holds, EVEN PAST its 3-day
  // paused_until (that date only drives the "nudge the Coordinator"
  // notification in recycle-stale-leads, not this gate). Ending this
  // state is entirely on Admin/Sales Coordinator verifying or denying
  // it — there's no time-based auto-resolution, since the employee
  // has nothing left to do here and shouldn't be nudged as if they do.
  if (lead.pause_reason === "VISIT_PENDING_VERIFICATION") {
    return "PAUSED";
  }

  // Client-hold (Snooze) or post-visit company-policy lock
  // (VISIT_LOCK) — an absolute override, checked before anything
  // status/board_stage-based below. A planned pause is not neglect;
  // nothing else in this function ever fires while it's active,
  // regardless of what board_stage or status says.
  if (lead.paused_until && now < new Date(lead.paused_until)) {
    return "PAUSED";
  }

  // Once a lead has left the LEADS column, the old fixed-clock SLA/
  // cooldown logic below (keyed on `status`) no longer applies to it
  // — it stays here, keyed on real activity, for as long as it
  // remains in Follow-up/Visit. (BOOKING is unreachable here — a
  // Booked lead is status=CONVERTED, already returned above.)
  //
  // status === "CONNECTED" is included here even when board_stage is
  // still "LEADS" — first contact has genuinely happened (that's what
  // CONNECTED means) whether or not the employee has also gotten
  // around to clicking "Move to Follow-up" to organize it on their
  // board. Without this, a lead marked CONNECTED but never manually
  // moved sat with ZERO enforcement forever: not the 2h timer (its own
  // `status === "NEW"` check already excludes it, since status has by
  // definition changed away from NEW) and not this inactivity-tracking
  // either (board_stage-gated, and it was never gated on status too).
  // Deliberately does NOT write board_stage itself anywhere — status
  // and board_stage stay independent, per the approved design; this
  // only changes what the RECYCLING ENGINE treats as "first contact
  // made," not what the employee's own board looks like.
  //
  // Also graduates on ANY genuine activity since assignment — a call/
  // WhatsApp click, a note, or a status log — even if status is still
  // "NEW" (e.g. the employee tried the client but hasn't picked an
  // outcome yet). Deliberately NOT gated on which specific action
  // happened (e.g. requiring a Call-button click specifically) —
  // that's both bypassable (nothing stops calling the RPC directly)
  // and a weak signal on its own (a tel: link click doesn't prove a
  // call was actually made or connected), so gating on it would block
  // legitimate cases without actually stopping a determined fake.
  // Genuinely-suspicious patterns (status logged, never a tracked
  // contact-click) are surfaced to Sales Coordinator/Admin as a
  // reporting signal instead — see Employee Summary. Excludes DATA
  // leads: their own attempt-count-based recycling (below) is the
  // deliberately-designed mechanism for them, not this one.
  const hasGenuineActivitySinceAssignment =
    lead.lead_type !== "DATA" &&
    Boolean(lead.assigned_at) &&
    Boolean(lead.last_activity_at) &&
    new Date(lead.last_activity_at as string).getTime() > new Date(lead.assigned_at as string).getTime();

  if ((lead.board_stage && lead.board_stage !== "LEADS") || lead.status === "CONNECTED" || hasGenuineActivitySinceAssignment) {

    const lastActivity = lead.last_activity_at ? new Date(lead.last_activity_at) : null;

    if (!lastActivity) {
      // Shouldn't happen — last_activity_at defaults to now() at
      // lead_history insert time and is bumped by every activity-
      // producing action from then on. Fail safe by not recycling on
      // missing data rather than guessing.
      return "FOLLOWUP_WITHIN_WINDOW";
    }

    const daysSinceActivity = (now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceActivity >= FOLLOWUP_INACTIVITY_RECYCLE_DAYS) {
      return "FOLLOWUP_INACTIVITY_RECYCLE_READY";
    }

    if (daysSinceActivity >= FOLLOWUP_INACTIVITY_WARNING_DAYS) {
      return "FOLLOWUP_INACTIVITY_WARNING";
    }

    // Deliberately its OWN distinct value, not "WITHIN_SLA" — that
    // string is the pre-Follow-up 2h-timer's "all good" signal, and
    // UI consumers (LeadCard) key their SLA-countdown badge purely off
    // it plus lead.sla_deadline being non-null. sla_deadline is never
    // cleared by the RPCs that move a lead into Follow-up/Visit, so
    // reusing "WITHIN_SLA" here made an already-irrelevant countdown
    // silently reappear the instant a lead entered this branch. A
    // distinct value makes that collision structurally impossible.
    return "FOLLOWUP_WITHIN_WINDOW";

  }

  // DATA leads, still unreached (never made it to CONNECTED): no
  // SLA-clock, no time-based cooldown — recycling is purely
  // attempt-count-based here. NOT_INTERESTED is deliberately NOT
  // included in this branch — it's a real outcome (the call
  // connected, they just weren't interested), not a failed contact
  // attempt, so it falls through to the same time-based cooldown
  // logic a LEAD would use, below.
  if (
    lead.lead_type === "DATA" &&
    (lead.status === "NEW" || lead.status === "NOT_CONNECTED" || lead.status === "SWITCHED_OFF")
  ) {
    return (lead.call_count ?? 0) >= MAX_DATA_ATTEMPTS ? "DATA_MAX_ATTEMPTS_REACHED" : "WITHIN_SLA";
  }

  if (lead.status === "NEW") {
    if (!lead.sla_deadline) {
      // Shouldn't happen — assignment engine sets this at assignment time.
      return "WITHIN_SLA";
    }
    return now >= new Date(lead.sla_deadline) ? "SLA_BREACHED" : "WITHIN_SLA";
  }

  if (
    lead.status === "NOT_CONNECTED" ||
    lead.status === "SWITCHED_OFF" ||
    lead.status === "NOT_INTERESTED"
  ) {
    if (!lastOutcomeAt) {
      // No timestamp to measure cooldown from — fail safe by not
      // recycling yet, rather than risk an early/incorrect recycle.
      return "COOLDOWN";
    }

    const cooldownDays = RECYCLE_COOLDOWN_DAYS[lead.status as keyof typeof RECYCLE_COOLDOWN_DAYS];
    const cooldownEnd = new Date(lastOutcomeAt);
    cooldownEnd.setDate(cooldownEnd.getDate() + cooldownDays);

    return now >= cooldownEnd ? "RECYCLE_READY" : "COOLDOWN";
  }

  return "NOT_APPLICABLE";
}
