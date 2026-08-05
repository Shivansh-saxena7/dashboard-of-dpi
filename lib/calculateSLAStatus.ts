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

interface LeadForSLA {
  status: string;
  sla_deadline: string | null;
  recycle_count: number;
  // Both optional and omitted by every pre-existing caller — absent
  // (or anything other than "DATA") behaves exactly like a LEAD
  // always has, so this is fully backward-compatible.
  lead_type?: string;
  call_count?: number;
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

  if (lead.recycle_count >= MAX_RECYCLES || notInterestedCount >= MAX_NOT_INTERESTED) {
    return "JUNK_ELIGIBLE";
  }

  if (lead.status === "CONNECTED") {
    return "NOT_APPLICABLE";
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
