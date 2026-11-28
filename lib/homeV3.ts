// Employee Home v3 (2026-11-29): pure helpers for the new look. Every number comes from useEmployeeHome (the same
// source as the old Home); these functions only pick and word them, so "Do this now", progress and follow-ups can never
// show two different numbers for the same thing.
import type { WorkingCalendar } from "./workingCalendar.ts";
import { isFollowUpOverdue, isMissedReminder, isPendingResult, isVisitDueToday, type UpNextItem as QItem } from "./employeeHome.ts";

const IST_OFFSET_MS = 5.5 * 3600e3;

export function istHour(now: number = Date.now()): number {
  return new Date(now + IST_OFFSET_MS).getUTCHours();
}

export function greeting(now: number = Date.now()): "Good morning" | "Good afternoon" | "Good evening" {
  const h = istHour(now);
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

// Placeholder "Message of the day" lines (a light real-estate smile), one per IST day, no repeat for 36 days. The strip
// takes a text prop, so an admin-written message can replace this later without touching the layout.
export const DAILY_LINES: string[] = [
  "A callback promised is a site visit waiting to happen.",
  "Every 'call me later' is a 'yes' that is still deciding.",
  "Follow-ups are like plants: water them daily and watch them grow into bookings.",
  "The best time to call a prospect was yesterday. The second best is now.",
  "A site visit beats a hundred brochures.",
  "Today's 'just looking' can be tomorrow's housewarming invite.",
  "Location, location, follow-up.",
  "Nobody ever booked a flat from a missed call.",
  "Smile while you dial: they can hear it.",
  "The keys to a new home start with your first 'Hello'.",
  "Every no gets you closer to the next yes.",
  "A good note today saves a confused call tomorrow.",
  "Prospects forget. Reminders do not.",
  "Square feet are sold one conversation at a time.",
  "Be the call they are happy to pick up.",
  "Today's follow-up is tomorrow's booking amount.",
  "If the client says 'send details', send them before the tea gets cold.",
  "The site looks even better when you are the one showing it.",
  "Consistency builds homes. Calls build bookings.",
  "Fortune favours the one who calls back on time.",
  "Every lead is someone's dream address.",
  "Booking day is just many good follow-up days stacked together.",
  "A warm lead cools fast. Call while it is hot.",
  "Your next call could be someone's biggest decision of the year.",
  "Visits are where interest turns into intent.",
  "Small talk, big tickets.",
  "Ask about their family; the right flat size follows.",
  "Late callback? A quick sorry and a clear next step works wonders.",
  "Plans change. Your follow-up should not.",
  "The best brochure is a happy visitor.",
  "Today is a great day to turn a 'maybe' into a site visit.",
  "Good prospects remember who called them back.",
  "Every booking starts with a number dialled.",
  "Clear the late ones first, then enjoy the rest of the list.",
  "A full calendar of visits is the best kind of busy.",
  "Close the day with zero overdue: future you will thank you."
];

export function messageOfTheDay(now: number = Date.now(), lines: string[] = DAILY_LINES): string {
  const day = Math.floor((now + IST_OFFSET_MS) / 86400e3);
  return lines[((day % lines.length) + lines.length) % lines.length];
}

// ---- v3 final (2026-11-29): one model for the whole Home, built from useEmployeeHome's full queue + reminder times.
// Every Home number (plan steps, spotlight, follow-ups, chips, visits) comes from here, so no two places can differ.

export type StepKey = "results" | "callbacks" | "new" | "late";
export const STEP_LABELS: Record<StepKey, string> = {
  results: "Save results for calls you made",
  callbacks: "Callbacks due now",
  new: "New leads (SLA)",
  late: "Late follow-ups"
};
export interface FollowUp {
  item: QItem;
  kind: "late" | "today";
  at: number | null;
  daysLate: number;
  why: "MISSED" | "OVERDUE" | "TODAY";
}
export interface HomeModel {
  steps: { key: StepKey; count: number; state: "done" | "current" | "later" }[];
  current: StepKey | null;
  left: number;
  late: FollowUp[];
  today: FollowUp[];
  lateBuckets: { d1: number; d2to3: number; d4plus: number };
  spotlight: FollowUp | null;
  visits: { item: QItem; at: number | null }[];
  newCount: number;
}

const DAY = 86400e3;
// Whole IST calendar days (a reminder yesterday at noon is 1 day late, whatever the time now).
const istDayIndex = (ms: number) => Math.floor((ms + IST_OFFSET_MS) / DAY);
export function homeModel(queue: QItem[], reminderAt: Map<string, number> | null | undefined, missedAt: Map<string, number> | null | undefined, calendar: WorkingCalendar | null, now: number = Date.now()): HomeModel {
  const late: FollowUp[] = [];
  const today: FollowUp[] = [];
  for (const it of queue) {
    const lead = it.lead;
    if (isMissedReminder(lead, missedAt)) {
      const at = missedAt?.get(lead.id) ?? null;
      late.push({ item: it, kind: "late", at, why: "MISSED", daysLate: at ? Math.max(1, istDayIndex(now) - istDayIndex(at)) : 1 });
    } else if (isFollowUpOverdue(lead, calendar)) {
      const v = lead.lead_history?.[0]?.last_activity_at;
      const at = v ? Date.parse(v) : NaN;
      late.push({ item: it, kind: "late", at: Number.isFinite(at) ? at : null, why: "OVERDUE", daysLate: Number.isFinite(at) ? Math.max(1, Math.floor((now - at) / DAY)) : 1 });
    } else if (reminderAt?.has(lead.id)) {
      today.push({ item: it, kind: "today", at: reminderAt.get(lead.id) ?? null, why: "TODAY", daysLate: 0 });
    }
  }
  late.sort((x, y) => y.daysLate - x.daysLate || (x.at ?? 0) - (y.at ?? 0));
  today.sort((x, y) => (x.at ?? Infinity) - (y.at ?? Infinity));
  const results = queue.filter((it) => isPendingResult(it.lead)).length;
  const callbacksDue = today.filter((f) => f.at !== null && f.at <= now).length;
  const newCount = queue.filter((it) => it.reason === "NEW").length;
  const counts: Record<StepKey, number> = { results, callbacks: callbacksDue, new: newCount, late: late.length };
  const order: StepKey[] = ["results", "callbacks", "new", "late"];
  const current = order.find((k) => counts[k] > 0) ?? null;
  const steps = order.map((key) => ({ key, count: counts[key], state: (counts[key] === 0 ? "done" : key === current ? "current" : "later") as "done" | "current" | "later" }));
  const lateBuckets = { d1: late.filter((f) => f.daysLate <= 1).length, d2to3: late.filter((f) => f.daysLate >= 2 && f.daysLate <= 3).length, d4plus: late.filter((f) => f.daysLate >= 4).length };
  // Next best lead: due now or late, Follow-up stage first, then the most urgent.
  const candidates = [...late, ...today.filter((f) => f.at !== null && f.at <= now)];
  const spotlight = candidates.find((f) => f.item.lead.board_stage === "FOLLOW_UP") ?? candidates[0] ?? null;
  const visits = queue.filter((it) => isVisitDueToday(it.lead, now)).map((item) => {
    const v = item.lead.lead_history?.[0]?.paused_until;
    const at = v ? Date.parse(v) : NaN;
    return { item, at: Number.isFinite(at) ? at : null };
  }).sort((x, y) => (x.at ?? Infinity) - (y.at ?? Infinity));
  return { steps, current, left: order.reduce((n, k) => n + counts[k], 0), late, today, lateBuckets, spotlight, visits, newCount };
}

// DATA-only employees (no LEAD leads, some DATA leads): the plan from their DATA counts (same useEmployeeHome data).
export type DataStepKey = "untouched" | "lastAttempt" | "atRisk";
export const DATA_STEP_LABELS: Record<DataStepKey, string> = { untouched: "Untouched data", lastAttempt: "Last attempt left", atRisk: "Still to call" };
export function dataPlanModel(d: { untouched: number; lastAttempt: number; atRisk: number }): { steps: { key: DataStepKey; count: number; state: "done" | "current" | "later" }[]; current: DataStepKey | null; left: number } {
  const order: DataStepKey[] = ["untouched", "lastAttempt", "atRisk"];
  const counts: Record<DataStepKey, number> = { untouched: d.untouched, lastAttempt: d.lastAttempt, atRisk: d.atRisk };
  const current = order.find((k) => counts[k] > 0) ?? null;
  return { steps: order.map((key) => ({ key, count: counts[key], state: counts[key] === 0 ? "done" : key === current ? "current" : "later" })), current, left: d.atRisk };
}

export function followUpWhen(f: FollowUp, now: number = Date.now()): string {
  if (f.why === "TODAY") return f.at ? (f.at <= now ? `Due now (${istClock(f.at)})` : `Due ${istClock(f.at)}`) : "Due today";
  if (f.why === "MISSED") return f.daysLate <= 1 ? "Missed yesterday" : `Missed ${f.daysLate} days ago`;
  return `${f.daysLate} day${f.daysLate === 1 ? "" : "s"} late`;
}

export function progressModel(resultsSaved: number, left: number): { done: number; left: number; pct: number; finished: boolean } {
  const total = resultsSaved + left;
  return { done: resultsSaved, left, pct: total === 0 ? 100 : Math.round((resultsSaved / total) * 100), finished: left === 0 };
}

export function istClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

export const STAGE_WORD: Record<string, string> = { LEADS: "Leads", FOLLOW_UP: "Follow-up", VISIT: "Visit", BOOKING: "Booking" };

// Preview / local only (never the live domain): ?home=p1 shows the previous Home, to compare without a database change.
export function homeVariantFromUrl(search: string, hostname: string, remembered: string | null = null): "v3" | "p1" {
  const preview = hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".vercel.app");
  if (!preview) return "v3";
  const asked = new URLSearchParams(search).get("home");
  if (asked === "p1" || asked === "v3") return asked;
  return remembered === "p1" ? "p1" : "v3";
}
export const HOME_VARIANT_KEY = "home-variant:v1";
