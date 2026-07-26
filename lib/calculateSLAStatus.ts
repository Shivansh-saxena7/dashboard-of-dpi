// Single source of truth for lead SLA / recycle-readiness state.
// Same pattern as components/calculateStatus.ts — one function, fixed
// set of string outputs, imported everywhere this decision is needed
// (assignment engine, recycling Edge Function, SLA countdown UI).

export type SLAStatus =
  | "WITHIN_SLA"
  | "SLA_BREACHED"
  | "COOLDOWN"
  | "RECYCLE_READY"
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

interface LeadForSLA {
  status: string;
  sla_deadline: string | null;
  recycle_count: number;
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
