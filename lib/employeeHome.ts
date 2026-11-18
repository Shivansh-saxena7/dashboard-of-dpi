// Employee Home, Phase 1 (2026-11-18): the feature flag and the "My leads" counts. Pure functions, no database.
// The counts use the exact rules /leads uses (components/LeadList.tsx imports the same functions), so a tile number and
// the list it opens always agree: stage tabs count every loaded lead by board_stage, "New" is
// isUntouchedInCurrentAssignment across all tabs (the Status=New filter bypasses the tab), "Recycling tomorrow" is
// recyclingTomorrowCutoff across all tabs (the filter bypasses the tab too).
import { isUntouchedInCurrentAssignment } from "./newLeadFilter.ts";
import { recyclingTomorrowCutoff } from "./recyclingTomorrow.ts";
import type { WorkingCalendar } from "./workingCalendar.ts";

export type HomeStage = "LEADS" | "FOLLOW_UP" | "VISIT" | "BOOKING";
export const HOME_STAGES: HomeStage[] = ["LEADS", "FOLLOW_UP", "VISIT", "BOOKING"];

// lead_engine_settings.employee_home_mode: "off" (default) | "admin_pilot" (only employee_home_pilot_ids) | "on".
// The row is read with select("*"): before the SQL is applied the column is simply missing, which means off. Anything
// unknown means off too, so a typo can never switch the new Home on for everyone.
export function homeModeAllows(settings: Record<string, unknown> | null | undefined, employeeId: string | null | undefined): boolean {
  if (!employeeId) return false;
  const mode = settings?.employee_home_mode;
  if (mode === "on") return true;
  if (mode !== "admin_pilot") return false;
  const pilots = settings?.employee_home_pilot_ids;
  return Array.isArray(pilots) && pilots.includes(employeeId);
}

export interface HomeLeadHistory {
  call_count?: number | null;
  first_call_at?: string | null;
  first_whatsapp_at?: string | null;
  outcome_at?: string | null;
  assigned_at?: string | null;
  last_activity_at?: string | null;
  paused_until?: string | null;
  pause_reason?: string | null;
}

export interface HomeLead {
  id: string;
  status: string;
  board_stage?: string | null;
  sla_deadline?: string | null;
  recycle_count?: number | null;
  is_personal_lead?: boolean | null;
  lead_history?: HomeLeadHistory[] | null;
}

// Same as the /leads tab badges.
export function stageCounts(leads: { board_stage?: string | null }[]): Record<HomeStage, number> {
  const counts: Record<HomeStage, number> = { LEADS: 0, FOLLOW_UP: 0, VISIT: 0, BOOKING: 0 };
  for (const lead of leads) {
    const stage = (lead.board_stage || "LEADS") as HomeStage;
    counts[stage] = (counts[stage] || 0) + 1;
  }
  return counts;
}

// The lead's "recycles within a working day" cutoff, as the /leads "Recycling tomorrow" filter computes it. Field for
// field what LeadList passed before 2026-11-18 (raw values, no defaults), so the answer cannot drift.
export function recyclingTomorrowCutoffFor(lead: HomeLead, calendar: WorkingCalendar | null, now: number = Date.now()): Date | null {
  const h = lead.lead_history?.[0];
  return recyclingTomorrowCutoff(
    {
      status: lead.status,
      sla_deadline: lead.sla_deadline,
      recycle_count: lead.recycle_count,
      board_stage: lead.board_stage,
      paused_until: h?.paused_until ?? null,
      last_activity_at: h?.last_activity_at ?? null,
      pause_reason: h?.pause_reason ?? null,
      assigned_at: h?.assigned_at ?? null
    } as any,
    h?.outcome_at ?? null,
    h?.call_count ?? 0,
    Boolean(lead.is_personal_lead),
    now,
    calendar
  );
}

export interface MyLeadCounts {
  total: number;
  stages: Record<HomeStage, number>;
  newCount: number;
  recyclingTomorrow: number;
}

export function myLeadCounts(leads: HomeLead[], calendar: WorkingCalendar | null, now: number = Date.now()): MyLeadCounts {
  return {
    total: leads.length,
    stages: stageCounts(leads),
    newCount: leads.filter((lead) => isUntouchedInCurrentAssignment(lead.lead_history?.[0])).length,
    recyclingTomorrow: leads.filter((lead) => recyclingTomorrowCutoffFor(lead, calendar, now) !== null).length
  };
}

// Deep links into /leads. ?filter=new and ?tab= are new (Phase 1); ?filter=recycling-tomorrow already existed.
export const HOME_LINKS = {
  newLeads: "/leads?filter=new",
  recyclingTomorrow: "/leads?filter=recycling-tomorrow",
  stage: (stage: HomeStage) => `/leads?tab=${stage}`,
  report: "/report"
};

// The /leads ?tab= value, or null when it is not a board tab.
export function tabFromParam(value: string | null | undefined): HomeStage | null {
  return value && (HOME_STAGES as string[]).includes(value) ? (value as HomeStage) : null;
}
