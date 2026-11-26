// Employee Home, Phase 1 (2026-11-18): the feature flag and the "My leads" counts. Pure functions, no database.
// The counts use the exact rules /leads uses (components/LeadList.tsx imports the same functions), so a tile number and
// the list it opens always agree: stage tabs count every loaded lead by board_stage, "New" is
// isUntouchedInCurrentAssignment across all tabs (the Status=New filter bypasses the tab), "Recycling tomorrow" is
// recyclingTomorrowCutoff across all tabs (the filter bypasses the tab too).
import { isUntouchedInCurrentAssignment } from "./newLeadFilter.ts";
import { recyclingTomorrowCutoff } from "./recyclingTomorrow.ts";
import { calculateSLAStatus } from "./calculateSLAStatus.ts";
import type { WorkingCalendar } from "./workingCalendar.ts";
import { ownersOnLeave, type LeavePeriodRow } from "./ownerLeave.ts";
import { employeesInReturnGrace, returnGraceDays } from "./ownerLeaveCalendar.ts";
import { bandOf, type Band } from "./callQuality.ts";

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
  last_call_click_at?: string | null;
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
// E5: every list link from the Home carries from=home, so /leads and /data show a "Back to Home" chip.
export function fromHome(href: string): string {
  return href + (href.includes("?") ? "&" : "?") + "from=home";
}

export const HOME_LINKS = {
  newLeads: "/leads?filter=new&from=home",
  recyclingTomorrow: "/leads?filter=recycling-tomorrow&from=home",
  stage: (stage: HomeStage) => `/leads?tab=${stage}&from=home`,
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

export type HomeFilter = "pending-result" | "reminders-missed" | "followup-overdue" | "reminders-today" | "visits-today" | "snooze-ends-today";
export const HOME_FILTER_LABELS: Record<HomeFilter, string> = {
  "pending-result": "Called, no result",
  "reminders-missed": "Missed reminders (yesterday)",
  "followup-overdue": "Overdue follow-ups",
  "reminders-today": "Reminders today",
  "visits-today": "Visits due today",
  "snooze-ends-today": "Snooze ends today"
};

// E6: a Snooze that ends within today's IST day (earlier today or later today) - the lead comes back to work today.
export function isSnoozeEndingToday(lead: HomeLead, now: number = Date.now()): boolean {
  const h = lead.lead_history?.[0];
  if (h?.pause_reason !== "SNOOZE" || !h?.paused_until) return false;
  const until = Date.parse(h.paused_until);
  const { start, end } = istDayBounds(now);
  return Number.isFinite(until) && until >= start && until < end;
}

// E4 (2026-11-19): reminders read as one bounded range (yesterday + today, IST) and split by day.
export function remindersByDay(rows: ReminderRow[] | null | undefined, now: number = Date.now()): { today: Map<string, number>; yesterday: Map<string, number> } {
  const { start, end } = istDayBounds(now);
  const yStart = start - DAY_MS;
  const inRange = (lo: number, hi: number) =>
    remindersByLead((rows || []).filter((r) => {
      const at = Date.parse(r.reminder_at);
      return Number.isFinite(at) && at >= lo && at < hi;
    }));
  return { today: inRange(start, end), yesterday: inRange(yStart, start) };
}

// A missed reminder: due yesterday (IST) and nothing was done on the lead since that reminder time.
export function isMissedReminder(lead: HomeLead, missed: Map<string, number> | null | undefined): boolean {
  const at = missed?.get(lead.id);
  if (at === undefined) return false;
  const last = lead.lead_history?.[0]?.last_activity_at ? Date.parse(lead.lead_history[0].last_activity_at as string) : NaN;
  return !Number.isFinite(last) || last < at;
}
export function homeFilterFromParam(value: string | null | undefined): HomeFilter | null {
  return value && Object.prototype.hasOwnProperty.call(HOME_FILTER_LABELS, value) ? (value as HomeFilter) : null;
}

export interface AttentionContext {
  calendar: WorkingCalendar | null;
  reminders: Map<string, number>;
  // Yesterday's reminders (E4); missing = none.
  missed?: Map<string, number>;
  // E6: leads an admin gave this employee (givenFilterLeads of get_given_lead_context, the /leads "Given by admin" set).
  given?: Set<string>;
  now?: number;
}

// The one predicate behind a Needs-attention number and the /leads list it opens (all tabs, like Status = New).
export function matchesHomeFilter(lead: HomeLead, filter: HomeFilter, ctx: AttentionContext): boolean {
  if (filter === "snooze-ends-today") return isSnoozeEndingToday(lead, ctx.now ?? Date.now());
  if (filter === "pending-result") return isQueueable(lead, ctx.now ?? Date.now()) && isPendingResult(lead);
  if (filter === "reminders-missed") return isQueueable(lead, ctx.now ?? Date.now()) && isMissedReminder(lead, ctx.missed);
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
    "pending-result": homeFilterLeads(leads, "pending-result", ctx).length,
    "reminders-missed": homeFilterLeads(leads, "reminders-missed", ctx).length,
    "followup-overdue": homeFilterLeads(leads, "followup-overdue", ctx).length,
    "reminders-today": homeFilterLeads(leads, "reminders-today", ctx).length,
    "visits-today": homeFilterLeads(leads, "visits-today", ctx).length,
    "snooze-ends-today": homeFilterLeads(leads, "snooze-ends-today", ctx).length
  };
}

export type UpNextReason = "PENDING" | "MISSED" | "REMINDER" | "RECYCLING" | "OVERDUE" | "VISIT" | "GIVEN" | "NEW";
export const UP_NEXT_LABELS: Record<UpNextReason, string> = {
  PENDING: "Called, no result",
  MISSED: "Missed reminder (yesterday)",
  REMINDER: "Reminder today",
  RECYCLING: "Recycles tomorrow",
  OVERDUE: "Follow-up overdue",
  VISIT: "Visit due today",
  GIVEN: "Given to you",
  NEW: "New"
};
export interface UpNextItem {
  lead: HomeLead;
  reason: UpNextReason;
}

// Pending result: Call was tapped in this assignment and no result was saved after it.
export function isPendingResult(lead: HomeLead): boolean {
  const h = lead.lead_history?.[0];
  const click = h?.last_call_click_at ? Date.parse(h.last_call_click_at) : NaN;
  if (!Number.isFinite(click)) return false;
  const outcome = h?.outcome_at ? Date.parse(h.outcome_at) : NaN;
  return !Number.isFinite(outcome) || outcome < click;
}

// Not in the queue: closed (Junk, Converted, Booking stage) or paused (Snooze, visit lock, pending verification,
// sibling hold) - except a Visit whose lock ends today.
const CLOSED_STATUSES = ["JUNK", "CONVERTED"];
export function isQueueable(lead: HomeLead, now: number = Date.now()): boolean {
  if (CLOSED_STATUSES.includes(lead.status) || (lead.board_stage || "LEADS") === "BOOKING") return false;
  const h = lead.lead_history?.[0];
  const paused = Boolean(h?.paused_until && Date.parse(h.paused_until) > now);
  return !paused || isVisitDueToday(lead, now);
}

// "Start with next lead" queue (Phase 3, plan section 3), also the Home's Up next (its first rows):
//   1 pending result (oldest click first), 2 reminder today (earliest first), 3 recycles tomorrow (soonest cutoff
//   first), 4 follow-up overdue (oldest activity first), 5 visit due today, 6 untouched New (SLA deadline first, then
//   oldest assignment). One entry per lead, own active assignment only (the list already is), no DB writes.
export function queueOrder(leads: HomeLead[], ctx: AttentionContext): UpNextItem[] {
  const now = ctx.now ?? Date.now();
  const time = (v: string | null | undefined) => (v ? Date.parse(v) : Number.POSITIVE_INFINITY);
  const h = (l: HomeLead) => l.lead_history?.[0];
  const seen = new Set<string>();
  const out: UpNextItem[] = [];
  const add = (list: HomeLead[], reason: UpNextReason) => {
    for (const lead of list) {
      if (seen.has(lead.id)) continue;
      seen.add(lead.id);
      out.push({ lead, reason });
    }
  };
  const open = leads.filter((lead) => isQueueable(lead, now));
  add(open.filter(isPendingResult).sort((a, b) => time(h(a)?.last_call_click_at) - time(h(b)?.last_call_click_at)), "PENDING");
  add(open.filter((l) => isMissedReminder(l, ctx.missed)).sort((a, b) => (ctx.missed?.get(a.id) ?? 0) - (ctx.missed?.get(b.id) ?? 0)), "MISSED");
  add(open.filter((l) => ctx.reminders.has(l.id)).sort((a, b) => (ctx.reminders.get(a.id) ?? 0) - (ctx.reminders.get(b.id) ?? 0)), "REMINDER");
  add(
    open
      .map((l) => ({ l, at: recyclingTomorrowCutoffFor(l, ctx.calendar, now)?.getTime() ?? null }))
      .filter((x) => x.at !== null)
      .sort((a, b) => (a.at as number) - (b.at as number))
      .map((x) => x.l),
    "RECYCLING"
  );
  add(open.filter((l) => isFollowUpOverdue(l, ctx.calendar)).sort((a, b) => time(h(a)?.last_activity_at) - time(h(b)?.last_activity_at)), "OVERDUE");
  add(open.filter((l) => isVisitDueToday(l, now)).sort((a, b) => time(h(a)?.paused_until) - time(h(b)?.paused_until)), "VISIT");
  // E6 (plan step 5): given by an admin and not yet called, before plain New.
  add(open.filter((l) => ctx.given?.has(l.id) ?? false).sort((a, b) => time(h(a)?.assigned_at) - time(h(b)?.assigned_at)), "GIVEN");
  add(
    open
      .filter((l) => isUntouchedInCurrentAssignment(h(l)))
      .sort((a, b) => time(a.sla_deadline) - time(b.sla_deadline) || time(h(a)?.assigned_at) - time(h(b)?.assigned_at)),
    "NEW"
  );
  return out;
}

export function upNext(leads: HomeLead[], ctx: AttentionContext, limit = 5): UpNextItem[] {
  return queueOrder(leads, ctx).slice(0, limit);
}

// Skip is local only: the skipped ids for today live in this tab's sessionStorage, never in the database.
export function queueSkipKey(employeeId: string, now: number = Date.now()): string {
  return `homeQueueSkip:v1:${employeeId}:${new Date(istDayBounds(now).start + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10)}`;
}

// ---- Data-only variant: an employee with no LEAD leads and at least one DATA lead. ----
export interface DataLead {
  id: string;
  status: string;
  board_stage?: string | null;
  lead_history?: HomeLeadHistory[] | null;
}
export const DATA_MAX_ATTEMPTS = 4; // lib/calculateSLAStatus.ts MAX_DATA_ATTEMPTS
// As components/DataCard.tsx: attempts matter while the card is "still at risk" (Leads stage, New / Not connected /
// Switched off); attempts left = max(4 - calls, 0).
export function dataStillAtRisk(lead: DataLead): boolean {
  const inLeadsStage = !lead.board_stage || lead.board_stage === "LEADS";
  return inLeadsStage && (lead.status === "NEW" || lead.status === "NOT_CONNECTED" || lead.status === "SWITCHED_OFF");
}
export function dataAttemptsLeft(lead: DataLead): number {
  return Math.max(DATA_MAX_ATTEMPTS - (lead.lead_history?.[0]?.call_count ?? 0), 0);
}
export interface DataCounts {
  total: number;
  untouched: number;
  callsLeft: number;
  lastAttempt: number;
  // E5: still being called (DataCard's "still at risk": Leads stage, New / Not connected / Switched off).
  atRisk: number;
}
export function dataCounts(leads: DataLead[]): DataCounts {
  const atRisk = leads.filter(dataStillAtRisk);
  return {
    total: leads.length,
    untouched: leads.filter((l) => isUntouchedInCurrentAssignment(l.lead_history?.[0])).length,
    callsLeft: atRisk.reduce((sum, l) => sum + dataAttemptsLeft(l), 0),
    lastAttempt: atRisk.filter((l) => dataAttemptsLeft(l) <= 1).length,
    atRisk: atRisk.length
  };
}

// "Due now" on the Start button: everything in the queue except plain untouched New leads.
export function queueSummary(items: UpNextItem[]): { urgent: number; total: number } {
  return { urgent: items.filter((x) => x.reason !== "NEW").length, total: items.length };
}

// Queue resume after a cold restart (E4): today's queue run is kept in localStorage per employee and list, and is
// dropped when the IST day changes.
export function queueDay(now: number = Date.now()): string {
  return new Date(istDayBounds(now).start + IST_OFFSET_MS).toISOString().slice(0, 10);
}
export function queueStoreKey(employeeId: string, listType: "LEAD" | "DATA"): string {
  return `homeQueue:v1:${employeeId}:${listType}`;
}
export function parseStoredQueue(raw: string | null | undefined, now: number = Date.now()): { ids: string[]; index: number } | null {
  if (!raw) return null;
  try {
    const q = JSON.parse(raw) as { day?: unknown; ids?: unknown; index?: unknown };
    if (q.day !== queueDay(now) || !Array.isArray(q.ids) || typeof q.index !== "number") return null;
    const ids = q.ids.filter((x): x is string => typeof x === "string");
    if (q.index < 0 || q.index >= ids.length) return null;
    return { ids, index: q.index };
  } catch {
    return null;
  }
}

export const HOME_ATTENTION_LINKS: Record<HomeFilter, string> = {
  "pending-result": "/leads?filter=pending-result&from=home",
  "reminders-missed": "/leads?filter=reminders-missed&from=home",
  "followup-overdue": "/leads?filter=followup-overdue&from=home",
  "reminders-today": "/leads?filter=reminders-today&from=home",
  "visits-today": "/leads?filter=visits-today&from=home",
  "snooze-ends-today": "/leads?filter=snooze-ends-today&from=home"
};

// Data-only queue (/data?queue=1): 1 called, no result yet (oldest click first), 2 untouched (oldest assignment
// first), 3 the other leads DataCard marks as still at risk with attempts left (fewest attempts left first, then
// oldest activity). Closed (Junk, Converted) and already-used-up leads stay out. No DB writes.
export function dataQueueOrder(leads: DataLead[]): string[] {
  const time = (v: string | null | undefined) => (v ? Date.parse(v) : Number.POSITIVE_INFINITY);
  const h = (l: DataLead) => l.lead_history?.[0];
  const open = leads.filter((l) => !CLOSED_STATUSES.includes(l.status));
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (list: DataLead[]) => {
    for (const l of list) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      out.push(l.id);
    }
  };
  add(open.filter((l) => isPendingResult(l as HomeLead)).sort((a, b) => time(h(a)?.last_call_click_at) - time(h(b)?.last_call_click_at)));
  add(open.filter((l) => isUntouchedInCurrentAssignment(h(l))).sort((a, b) => time(h(a)?.assigned_at) - time(h(b)?.assigned_at)));
  add(
    open
      .filter((l) => dataStillAtRisk(l) && dataAttemptsLeft(l) > 0)
      .sort((a, b) => dataAttemptsLeft(a) - dataAttemptsLeft(b) || time(h(a)?.last_activity_at) - time(h(b)?.last_activity_at))
  );
  return out;
}

// ---- E6 (2026-11-19): leave status, Given to you, Call Quality card. Pure, no DB. ----

export type LeaveStatus =
  | { kind: "ON_LEAVE"; until: string | null }
  | { kind: "GRACE"; until: string }
  | { kind: "UPCOMING"; from: string; to: string | null }
  | null;

const addDaysYmd = (ymd: string, n: number) => new Date(Date.parse(ymd + "T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);

// The employee's own leave, by the same rules the sweep uses (lib/ownerLeave.ts, lib/ownerLeaveCalendar.ts): on leave
// today; else in return grace (the first 2 working days after a leave with an end date; weekly off and holidays do not
// count, open-ended leave has none); else a leave starting within the next `horizonDays` days.
export function leaveStatus(rows: LeavePeriodRow[] | null | undefined, employeeId: string, todayYmd: string, cal: WorkingCalendar | null, horizonDays = 7): LeaveStatus {
  const mine = (rows ?? []).filter((r) => r.employee_id === employeeId);
  if (ownersOnLeave(mine, todayYmd).has(employeeId)) {
    const row = mine.find((r) => r.start_date <= todayYmd && (!r.end_date || r.end_date >= todayYmd));
    return { kind: "ON_LEAVE", until: row?.end_date ?? null };
  }
  if (employeesInReturnGrace(mine, todayYmd, cal).has(employeeId)) {
    for (const r of mine) {
      const days = returnGraceDays([r], employeeId, cal);
      if (days.includes(todayYmd)) return { kind: "GRACE", until: days[days.length - 1] };
    }
  }
  const limit = addDaysYmd(todayYmd, horizonDays);
  const next = mine.filter((r) => r.start_date > todayYmd && r.start_date <= limit).sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  return next ? { kind: "UPCOMING", from: next.start_date, to: next.end_date } : null;
}

export function shortYmd(ymd: string): string {
  const d = new Date(ymd + "T00:00:00Z");
  return `${d.getUTCDate()} ${d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}`;
}

export function leaveStatusText(status: LeaveStatus): string | null {
  if (!status) return null;
  if (status.kind === "ON_LEAVE") return status.until ? `On leave until ${shortYmd(status.until)}. Your lead timers are paused.` : "On leave. Your lead timers are paused.";
  if (status.kind === "GRACE") return `Back from leave. Until ${shortYmd(status.until)} your lead timers stay paused and no recycled leads are given to you.`;
  return status.to ? `Leave coming up: ${shortYmd(status.from)} to ${shortYmd(status.to)}.` : `Leave coming up from ${shortYmd(status.from)}.`;
}

// Call Quality card: what My Call Quality shows at the top, for this employee only. Same choice of Lead / Data lines as
// components/MyCallQuality.tsx (Data only when there were Data dials; Lead when there were Lead dials or no Data), the
// same band rule (bandOf) and the same "Not enough data yet". Display only.
export interface CallQualityCardLine {
  label: string | null;
  band: Band | null;
  bandText: string;
  score: number | null;
}
export interface CallQualityCardModel {
  lines: CallQualityCardLine[];
  enforced: boolean;
  estimated: boolean;
}
export function callQualityCardModel(summary: {
  enforced: boolean;
  estimated: boolean;
  employees: { by_card_type: Record<string, { dial_clicks?: number | null; genuine_score?: number | null } | undefined> }[];
} | null | undefined): CallQualityCardModel | null {
  if (!summary) return null;
  const me = summary.employees?.[0];
  const lead = me?.by_card_type?.LEAD;
  const data = me?.by_card_type?.DATA;
  const showData = (data?.dial_clicks ?? 0) > 0;
  const showLead = (lead?.dial_clicks ?? 0) > 0 || !showData;
  const line = (score: number | null | undefined, label: string | null): CallQualityCardLine => {
    const band = bandOf(score ?? null);
    return { label, band, bandText: band ?? "Not enough data yet", score: score ?? null };
  };
  const lines: CallQualityCardLine[] = [];
  if (showLead) lines.push(line(lead?.genuine_score, showData ? "Lead cards" : null));
  if (showData) lines.push(line(data?.genuine_score, "Data cards"));
  return { lines, enforced: Boolean(summary.enforced), estimated: Boolean(summary.estimated) };
}

// E7: social posts summary for the collapsed card (pure; the read is lib/useSocialSummary.ts).
export interface SocialSummary {
  total: number;
  pending: number;
}

// A post still to like = Instagram or Facebook not done yet (the card's "IG Like" / "FB Like" columns).
export function socialSummary(rows: { ig_done?: boolean | null; fb_done?: boolean | null }[] | null | undefined): SocialSummary {
  const list = rows ?? [];
  return { total: list.length, pending: list.filter((r) => !(r.ig_done && r.fb_done)).length };
}

export function socialSummaryText(s: SocialSummary | null): string | null {
  if (!s) return null;
  if (s.total === 0) return "No posts today";
  if (s.pending === 0) return "All posts done today";
  return `${s.pending} post${s.pending === 1 ? "" : "s"} to like today`;
}

