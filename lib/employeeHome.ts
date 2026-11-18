// Employee Home, Phase 1 (2026-11-18): the feature flag and the "My leads" counts. Pure functions, no database.
// The counts use the exact rules /leads uses (components/LeadList.tsx imports the same functions), so a tile number and
// the list it opens always agree: stage tabs count every loaded lead by board_stage, "New" is
// isUntouchedInCurrentAssignment across all tabs (the Status=New filter bypasses the tab), "Recycling tomorrow" is
// recyclingTomorrowCutoff across all tabs (the filter bypasses the tab too).
import { isUntouchedInCurrentAssignment } from "./newLeadFilter.ts";
import { recyclingTomorrowCutoff } from "./recyclingTomorrow.ts";
import { calculateSLAStatus } from "./calculateSLAStatus.ts";
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
  id?: string | null;
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
  name?: string | null;
  mobile?: string | null;
  project?: string | null;
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

// ---- Phase 2 (2026-11-18): Needs attention, reminders today, Up next. Shared by the Home and /leads (filters). ----

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Today's IST calendar day as [start, end) in UTC milliseconds.
export function istDayBounds(now: number = Date.now()): { start: number; end: number } {
  const start = Math.floor((now + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
  return { start, end: start + DAY_MS };
}

// "Overdue follow-up" = the card shows "Needs follow-up" or "Going stale": calculateSLAStatus with exactly the inputs
// components/LeadCard.tsx gives it (LeadList's flattened card fields, not-interested count 0, not on leave).
export const FOLLOW_UP_OVERDUE_STATUSES = ["FOLLOWUP_INACTIVITY_WARNING", "FOLLOWUP_INACTIVITY_RECYCLE_READY"];
export function isFollowUpOverdue(lead: HomeLead, calendar: WorkingCalendar | null): boolean {
  const h = lead.lead_history?.[0];
  const status = calculateSLAStatus(
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
    0,
    false,
    (lead.is_personal_lead ?? false) as boolean,
    calendar
  );
  return FOLLOW_UP_OVERDUE_STATUSES.includes(status);
}

// "Visit due today" = a Visit lead whose visit lock ends before the end of today (IST): the visit should happen or be
// updated today, before the lead can recycle.
export function isVisitDueToday(lead: HomeLead, now: number = Date.now()): boolean {
  const h = lead.lead_history?.[0];
  if ((lead.board_stage || "LEADS") !== "VISIT" || h?.pause_reason !== "VISIT_LOCK" || !h?.paused_until) return false;
  const until = Date.parse(h.paused_until);
  return Number.isFinite(until) && until < istDayBounds(now).end;
}

export interface ReminderRow {
  lead_id: string;
  reminder_at: string;
}

// Earliest reminder today per lead.
export function remindersByLead(rows: ReminderRow[] | null | undefined): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows || []) {
    const at = Date.parse(row.reminder_at);
    if (!row.lead_id || !Number.isFinite(at)) continue;
    const prev = map.get(row.lead_id);
    if (prev === undefined || at < prev) map.set(row.lead_id, at);
  }
  return map;
}

export type HomeFilter = "followup-overdue" | "reminders-today" | "visits-today";
export const HOME_FILTER_LABELS: Record<HomeFilter, string> = {
  "followup-overdue": "Overdue follow-ups",
  "reminders-today": "Reminders today",
  "visits-today": "Visits due today"
};
export function homeFilterFromParam(value: string | null | undefined): HomeFilter | null {
  return value && Object.prototype.hasOwnProperty.call(HOME_FILTER_LABELS, value) ? (value as HomeFilter) : null;
}

export interface AttentionContext {
  calendar: WorkingCalendar | null;
  reminders: Map<string, number>;
  now?: number;
}

// The one predicate behind a Needs-attention number and the /leads list it opens (all tabs, like Status = New).
export function matchesHomeFilter(lead: HomeLead, filter: HomeFilter, ctx: AttentionContext): boolean {
  if (filter === "followup-overdue") return isFollowUpOverdue(lead, ctx.calendar);
  if (filter === "reminders-today") return ctx.reminders.has(lead.id);
  return isVisitDueToday(lead, ctx.now ?? Date.now());
}

export function homeFilterLeads<T extends HomeLead>(leads: T[], filter: HomeFilter, ctx: AttentionContext): T[] {
  return leads.filter((lead) => matchesHomeFilter(lead, filter, ctx));
}

export type AttentionCounts = Record<HomeFilter, number>;
export function attentionCounts(leads: HomeLead[], ctx: AttentionContext): AttentionCounts {
  return {
    "followup-overdue": homeFilterLeads(leads, "followup-overdue", ctx).length,
    "reminders-today": homeFilterLeads(leads, "reminders-today", ctx).length,
    "visits-today": homeFilterLeads(leads, "visits-today", ctx).length
  };
}

export type UpNextReason = "REMINDER" | "OVERDUE" | "RECYCLING" | "VISIT" | "NEW";
export const UP_NEXT_LABELS: Record<UpNextReason, string> = {
  REMINDER: "Reminder today",
  OVERDUE: "Follow-up overdue",
  RECYCLING: "Recycles tomorrow",
  VISIT: "Visit due today",
  NEW: "New"
};
export interface UpNextItem {
  lead: HomeLead;
  reason: UpNextReason;
}

// Up next: reminders due today (earliest first), overdue follow-ups (oldest activity first), recycling tomorrow
// (soonest cutoff first), visits due today, then untouched New (oldest assignment first). One row per lead, paused
// leads (Snooze, pending verification, sibling hold) left out except a Visit due today.
export function upNext(leads: HomeLead[], ctx: AttentionContext, limit = 5): UpNextItem[] {
  const now = ctx.now ?? Date.now();
  const time = (v: string | null | undefined) => (v ? Date.parse(v) : Number.POSITIVE_INFINITY);
  const paused = (lead: HomeLead) => {
    const h = lead.lead_history?.[0];
    return Boolean(h?.paused_until && Date.parse(h.paused_until) > now);
  };
  const seen = new Set<string>();
  const out: UpNextItem[] = [];
  const add = (list: HomeLead[], reason: UpNextReason) => {
    for (const lead of list) {
      if (out.length >= limit) return;
      if (seen.has(lead.id)) continue;
      seen.add(lead.id);
      out.push({ lead, reason });
    }
  };
  const open = leads.filter((lead) => !paused(lead));
  add(open.filter((l) => ctx.reminders.has(l.id)).sort((a, b) => (ctx.reminders.get(a.id) ?? 0) - (ctx.reminders.get(b.id) ?? 0)), "REMINDER");
  add(open.filter((l) => isFollowUpOverdue(l, ctx.calendar)).sort((a, b) => time(a.lead_history?.[0]?.last_activity_at) - time(b.lead_history?.[0]?.last_activity_at)), "OVERDUE");
  add(
    open
      .map((l) => ({ l, at: recyclingTomorrowCutoffFor(l, ctx.calendar, now)?.getTime() ?? null }))
      .filter((x) => x.at !== null)
      .sort((a, b) => (a.at as number) - (b.at as number))
      .map((x) => x.l),
    "RECYCLING"
  );
  add(leads.filter((l) => isVisitDueToday(l, now)).sort((a, b) => time(a.lead_history?.[0]?.paused_until) - time(b.lead_history?.[0]?.paused_until)), "VISIT");
  add(open.filter((l) => isUntouchedInCurrentAssignment(l.lead_history?.[0])).sort((a, b) => time(a.lead_history?.[0]?.assigned_at) - time(b.lead_history?.[0]?.assigned_at)), "NEW");
  return out;
}

export const HOME_ATTENTION_LINKS: Record<HomeFilter, string> = {
  "followup-overdue": "/leads?filter=followup-overdue",
  "reminders-today": "/leads?filter=reminders-today",
  "visits-today": "/leads?filter=visits-today"
};
